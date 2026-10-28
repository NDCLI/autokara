import { describe, expect, it } from 'vitest'
import { createNewProject } from '../../state/projectFactory'
import { DEFAULT_EXPORT_OPTIONS, DEFAULT_PROVIDER } from '../../../shared/contracts'
import { beginHeldWord, endHeldWord, finishWordRecording, markWord, startWordRecording, wordsForRecording } from './recording'

describe('manual word recording', () => {
  const segment = createNewProject({ provider: DEFAULT_PROVIDER, exportOptions: DEFAULT_EXPORT_OPTIONS }).segments[0]

  it('creates one word entry per token when timings are absent', () => {
    const words = wordsForRecording({ ...segment, text: 'Một hai ba', words: [] })
    expect(words.map((word) => word.text)).toEqual(['Một', 'hai', 'ba'])
    expect(words.every((word) => word.end > word.start)).toBe(true)
  })

  it('preserves matching existing words', () => {
    expect(wordsForRecording(segment)).toEqual(segment.words)
  })

  it('starts and ends a held word without duplicate keydown stamps', () => {
    const session = startWordRecording({ ...segment, text: 'Một hai', words: [] })
    const held = beginHeldWord(session, session.segmentStart + 0.4)
    expect(held?.spaceHeld).toBe(true)
    expect(beginHeldWord(held!, session.segmentStart + 0.5)).toBeNull()
    const ended = endHeldWord(held!, session.segmentStart + 1.3)
    expect(ended?.words[0].start).toBeCloseTo(session.segmentStart + 0.4)
    expect(ended?.words[0].end).toBeCloseTo(session.segmentStart + 1.3)
    expect(ended?.nextIndex).toBe(1)
  })

  it('stamps words in order and closes the prior word', () => {
    const session = startWordRecording({ ...segment, text: 'Một hai', words: [] })
    const first = markWord(session, session.segmentStart + 0.4)
    expect(first?.nextIndex).toBe(1)
    const second = markWord(first!, session.segmentStart + 1.2)
    expect(second?.words[0].end).toBeCloseTo(session.segmentStart + 1.2)
    expect(second?.nextIndex).toBe(2)
    expect(finishWordRecording(second!)[1].end).toBe(session.segmentEnd)
  })

  it('rejects backward and duplicate stamps without advancing', () => {
    const session = startWordRecording({ ...segment, text: 'Một hai', words: [] })
    const first = markWord(session, session.segmentStart + 1)
    expect(markWord(first!, session.segmentStart + 1)).toBeNull()
    expect(markWord(first!, session.segmentStart + 0.5)).toBeNull()
  })

  it('clamps stamps to segment bounds', () => {
    const session = startWordRecording({ ...segment, text: 'Một', words: [] })
    const stamped = markWord(session, -10)
    expect(stamped?.words[0].start).toBe(session.segmentStart)
  })
})
