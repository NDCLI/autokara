const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const { createJobRegistry } = require('./job-registry.cjs')

describe('job registry', () => {
  it('rejects empty and duplicate IDs while preserving the original job', () => {
    const registry = createJobRegistry()
    assert.throws(() => registry.register({ id: '' }), /Mã job/)
    const original = registry.register({ id: 'same', owner: 'window-a' })
    assert.throws(() => registry.register({ id: 'same', owner: 'window-b' }), /Mã job/)
    assert.equal(registry.get('same'), original)
  })

  it('cancels only jobs owned by the closing window', () => {
    const registry = createJobRegistry()
    registry.register({ id: 'a', owner: 'window-a' })
    registry.register({ id: 'b', owner: 'window-b' })
    const canceled = []
    registry.cancelOwned('window-a', (job) => canceled.push(job.id))
    assert.deepEqual(canceled, ['a'])
  })

  it('drains all active work before allowing app shutdown to continue', async () => {
    const registry = createJobRegistry()
    let finish
    const finished = new Promise((resolve) => { finish = resolve })
    const job = registry.register({ id: 'active', owner: 'window-a', finished })
    let idle = false
    const waiting = registry.waitForIdle().then(() => { idle = true })
    await Promise.resolve()
    assert.equal(idle, false)
    finish()
    registry.finish(job)
    await waiting
    assert.equal(idle, true)
  })
})
