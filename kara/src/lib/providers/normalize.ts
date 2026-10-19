import type { NormalizedTranscript, ProviderProfile, TimedWord } from '../../../shared/contracts'

export type ProviderError = { status?: number; message: string }

export function readPath(value: unknown, path: string): unknown {
  if (!path.trim()) return value
  return path.split('.').reduce<unknown>((current, part) => {
    const pieces = part.match(/^([^\[]+)(?:\[(\d+)\])?$/)
    if (!pieces || !current || typeof current !== 'object') return undefined
    const next = (current as Record<string, unknown>)[pieces[1]]
    return pieces[2] === undefined ? next : Array.isArray(next) ? next[Number(pieces[2])] : undefined
  }, value)
}

function makeId(prefix: string, index: number): string {
  return `${prefix}-${index + 1}`
}

function toNumber(value: unknown, fallback = 0): number {
  const number = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(number) ? number : fallback
}

function normalizeWords(raw: unknown, segmentStart: number, segmentEnd: number, segmentIndex: number): TimedWord[] {
  if (!Array.isArray(raw)) return []
  return raw.flatMap((item, index) => {
    if (!item || typeof item !== 'object') return []
    const word = item as Record<string, unknown>
    const text = String(word.punctuated_word ?? word.word ?? word.text ?? '').trim()
    if (!text) return []
    const start = Math.max(segmentStart, toNumber(word.start, segmentStart))
    const end = Math.max(start + 0.01, Math.min(segmentEnd, toNumber(word.end, start + 0.1)))
    return [{ id: makeId(`word-${segmentIndex}`, index), text, start, end, confidence: toNumber(word.confidence, 1) }]
  })
}

function segmentFromRaw(item: unknown, index: number, words: TimedWord[] = []): NormalizedTranscript['segments'][number] | null {
  if (!item || typeof item !== 'object') return null
  const value = item as Record<string, unknown>
  const start = toNumber(value.start ?? value.startTime)
  const end = Math.max(start + 0.1, toNumber(value.end ?? value.endTime, start + 1))
  const nestedWords = normalizeWords(value.words, start, end, index)
  const text = String(value.text ?? value.transcript ?? value.content ?? nestedWords.map((word) => word.text).join(' ')).trim()
  if (!text) return null
  return {
    id: String(value.id ?? makeId('segment', index)),
    text,
    start,
    end,
    speakerId: value.speaker !== undefined ? String(value.speaker) : value.speakerId !== undefined ? String(value.speakerId) : undefined,
    confidence: value.confidence === undefined ? undefined : toNumber(value.confidence),
    words: nestedWords.length ? nestedWords : words,
  }
}

export function normalizeCustomResponse(payload: unknown, profile: ProviderProfile): NormalizedTranscript {
  const rawSegments = readPath(payload, profile.customSegmentsPath ?? 'segments')
  const rawWords = readPath(payload, profile.customWordsPath ?? 'words')
  const words = normalizeWords(rawWords, 0, Number.MAX_SAFE_INTEGER, 0)
  const segments = Array.isArray(rawSegments)
    ? rawSegments.map((item, index) => segmentFromRaw(item, index, words)).filter((item): item is NormalizedTranscript['segments'][number] => item !== null)
    : []
  if (!segments.length) throw new Error('Provider không trả về segments hợp lệ. Kiểm tra JSON path và response mapping.')
  return { segments }
}

export function normalizeDeepgramResponse(payload: unknown): NormalizedTranscript {
  const value = payload as { results?: { channels?: Array<{ alternatives?: Array<{ transcript?: string; paragraphs?: { paragraphs?: Array<Record<string, unknown>> }; words?: unknown[] }> }> }; metadata?: { duration?: number } }
  const alternative = value.results?.channels?.[0]?.alternatives?.[0]
  if (!alternative) throw new Error('Deepgram response không có channel/alternative.')
  const words = normalizeWords(alternative.words, 0, Number.MAX_SAFE_INTEGER, 0)
  const paragraphs = alternative.paragraphs?.paragraphs
  if (Array.isArray(paragraphs) && paragraphs.length) {
    const segments = paragraphs.map((paragraph, index) => {
      const paragraphWords = normalizeWords(paragraph.sentences ?? paragraph.words, toNumber(paragraph.start), toNumber(paragraph.end, toNumber(paragraph.start) + 1), index)
      return segmentFromRaw({ ...paragraph, text: paragraph.text ?? paragraphWords.map((word) => word.text).join(' '), speaker: paragraph.speaker }, index, paragraphWords)
    }).filter((item): item is NormalizedTranscript['segments'][number] => item !== null)
    if (segments.length) return { segments, duration: value.metadata?.duration }
  }
  const transcript = String(alternative.transcript ?? '').trim()
  if (!transcript) throw new Error('Deepgram response không có transcript.')
  const start = words[0]?.start ?? 0
  const end = words.at(-1)?.end ?? Math.max(1, start + 1)
  return { segments: [{ id: 'segment-1', text: transcript, start, end, words }], duration: value.metadata?.duration }
}

export function isHttpSuccess(status: number): boolean {
  return status >= 200 && status < 300
}
