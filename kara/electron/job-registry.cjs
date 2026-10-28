function createJobRegistry() {
  const jobs = new Map()
  return {
    get: (id) => jobs.get(id),
    has: (id) => jobs.has(id),
    delete: (id) => jobs.delete(id),
    values: () => jobs.values(),
    register(job) {
      if (!job || typeof job.id !== 'string' || !job.id || jobs.has(job.id)) throw new Error('Mã job không hợp lệ hoặc đang được sử dụng.')
      let finish
      job.done = new Promise((resolve) => { finish = resolve })
      job.finish = finish
      jobs.set(job.id, job)
      return job
    },
    finish(job) {
      if (job && jobs.get(job.id) === job) job.finish?.()
    },
    cancelOwned(owner, cancel) {
      for (const job of jobs.values()) if (job.owner === owner) cancel(job)
    },
    cancelAll(cancel) {
      for (const job of jobs.values()) cancel(job)
    },
    async waitForIdle() {
      await Promise.allSettled([...jobs.values()].map((job) => job.done ?? job.finished ?? Promise.resolve()))
    },
  }
}

module.exports = { createJobRegistry }
