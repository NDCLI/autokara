import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createTranscriptionCache } from '../../electron/transcription-cache.cjs'

const tempDirectories: string[] = []

async function makeTempDirectory() {
  const directory = await mkdtemp(path.join(tmpdir(), 'kara-cache-test-'))
  tempDirectories.push(directory)
  return directory
}

afterEach(async () => {
  await Promise.all(tempDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe('transcription cache', () => {
  it('keys entries by audio bytes, provider settings, lyrics and credential scope', async () => {
    const directory = await makeTempDirectory()
    const audio = path.join(directory, 'song.wav')
    await writeFile(audio, 'audio bytes A')
    const cache = createTranscriptionCache({ directory: path.join(directory, 'cache') })
    const profile = { kind: 'local', model: 'small', language: 'vi', localSource: 'original' }
    const baseline = await cache.keyFor(audio, profile, 'lời một')
    expect(await cache.keyFor(audio, { ...profile, model: 'medium' }, 'lời một')).not.toBe(baseline)
    expect(await cache.keyFor(audio, { ...profile, localPythonPath: 'C:/venv/python.exe' }, 'lời một')).not.toBe(baseline)
    expect(await cache.keyFor(audio, profile, 'lời hai')).not.toBe(baseline)
    expect(await cache.keyFor(audio, profile, 'lời một', 'credential-a')).not.toBe(baseline)
    expect(await cache.keyFor(audio, profile, 'lời một', '', '2.0')).not.toBe(baseline)
    expect(await cache.keyFor(audio, { ...profile, localSource: 'vocal' }, 'lời một')).not.toBe(baseline)
    await writeFile(audio, 'audio bytes B')
    expect(await cache.keyFor(audio, profile, 'lời một')).not.toBe(baseline)
  })

  it('persists valid results and prunes least recently used entries to its configured limit', async () => {
    const directory = await makeTempDirectory()
    const audio = path.join(directory, 'song.wav')
    await writeFile(audio, 'same audio')
    const cache = createTranscriptionCache({ directory: path.join(directory, 'cache'), maxEntries: 1 })
    const profile = { kind: 'local', model: 'small', language: 'vi' }
    const firstKey = await cache.keyFor(audio, profile, 'first')
    const secondKey = await cache.keyFor(audio, profile, 'second')
    const result = { duration: 2, segments: [{ id: 's', text: 'xin chào', start: 0, end: 2, words: [] }] }
    await cache.write(firstKey, result)
    expect(await cache.read(firstKey)).toEqual(result)
    await cache.write(secondKey, result)
    expect(await cache.read(secondKey)).toEqual(result)
    expect(await cache.read(firstKey)).toBeNull()
  })

  it('keeps invocation-order newest entry when concurrent writes share a timestamp tick', async () => {
    const directory = await makeTempDirectory()
    const audio = path.join(directory, 'song.wav')
    await writeFile(audio, 'same audio')
    const cache = createTranscriptionCache({ directory: path.join(directory, 'cache'), maxEntries: 1 })
    const profile = { kind: 'local', model: 'small', language: 'vi' }
    const keys = await Promise.all(['first', 'second', 'third'].map((lyrics) => cache.keyFor(audio, profile, lyrics)))
    const result = { duration: 2, segments: [{ id: 's', text: 'xin chào', start: 0, end: 2, words: [] }] }

    await Promise.all(keys.map((key) => cache.write(key, result)))

    expect(await cache.read(keys[2])).toEqual(result)
    expect(await cache.read(keys[0])).toBeNull()
    expect(await cache.read(keys[1])).toBeNull()
  })
})
