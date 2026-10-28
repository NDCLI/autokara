const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { createRecoveryStore } = require('./recovery-store.cjs')

describe('recovery store', () => {
  it('serializes concurrent saves and leaves the latest project on disk', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'kara-recovery-'))
    const file = path.join(directory, 'recovery.json')
    const store = createRecoveryStore(file)
    await Promise.all([store.save({ projectId: 'a', revision: 1 }), store.save({ projectId: 'a', revision: 2 })])
    assert.deepEqual(JSON.parse(await store.load()), { projectId: 'a', revision: 2 })
    assert.deepEqual(await fs.readdir(directory), ['recovery.json'])
    await fs.rm(directory, { recursive: true, force: true })
  })

  it('orders dismissal after a pending save so a cleared recovery cannot reappear', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'kara-recovery-'))
    const file = path.join(directory, 'recovery.json')
    const store = createRecoveryStore(file)
    await Promise.all([store.save({ projectId: 'a', revision: 1 }), store.clear()])
    assert.equal(await store.load(), null)
    assert.deepEqual(await fs.readdir(directory), [])
    await fs.rm(directory, { recursive: true, force: true })
  })

  it('cleans the temporary file and accepts later operations after a failed save', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'kara-recovery-'))
    const file = path.join(directory, 'recovery.json')
    const brokenFs = { ...fs, rename: async () => { throw new Error('rename failed') } }
    const store = createRecoveryStore(file, brokenFs, () => 'fixed')
    await assert.rejects(store.save({ projectId: 'a', revision: 1 }), /rename failed/)
    assert.deepEqual(await fs.readdir(directory), [])
    await store.clear()
    await fs.rm(directory, { recursive: true, force: true })
  })
})
