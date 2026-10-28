const fs = require('node:fs/promises')
const { randomUUID } = require('node:crypto')

function createRecoveryStore(filePath, fileSystem = fs, makeId = randomUUID) {
  let queue = Promise.resolve()
  const enqueue = (operation) => {
    const result = queue.then(operation)
    queue = result.catch(() => undefined)
    return result
  }

  return {
    load: () => enqueue(async () => {
      try { return await fileSystem.readFile(filePath, 'utf8') }
      catch (error) { if (error.code === 'ENOENT') return null; throw error }
    }),
    save: (project) => enqueue(async () => {
      const temporary = `${filePath}.${makeId()}.tmp`
      await fileSystem.mkdir(require('node:path').dirname(filePath), { recursive: true })
      try {
        await fileSystem.writeFile(temporary, JSON.stringify(project), { encoding: 'utf8', flag: 'wx' })
        await fileSystem.rename(temporary, filePath)
      } catch (error) {
        await fileSystem.rm(temporary, { force: true }).catch(() => {})
        throw error
      }
    }),
    clear: () => enqueue(() => fileSystem.rm(filePath, { force: true })),
  }
}

module.exports = { createRecoveryStore }
