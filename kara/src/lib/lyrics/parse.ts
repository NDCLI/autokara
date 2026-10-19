import type { LyricSegment, NormalizedTranscript, SpeakerRole, TimedWord } from '../../../shared/contracts'

export type ParsedLyric = { text: string; start?: number; end?: number; words?: TimedWord[] }

const makeId = () => globalThis.crypto?.randomUUID?.() ?? `seg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

function parseLrcTime(value: string): number | null {
  const match = value.match(/^(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?$/)
  if (!match) return null
  const fraction = match[3] ? Number(`0.${match[3]}`) : 0
  return Number(match[1]) * 60 + Number(match[2]) + fraction
}

function parseAssDialogue(line: string): ParsedLyric | null {
  if (!/^Dialogue:/i.test(line)) return null
  const fields = line.slice(line.indexOf(':') + 1).split(',')
  if (fields.length < 10) return null
  const start = parseAssTime(fields[1])
  const end = parseAssTime(fields[2])
  const text = fields.slice(9).join(',').replace(/\{[^}]*\}/g, '').replace(/\\N/g, ' ').trim()
  if (!text || start === null || end === null) return null
  return { text, start, end }
}

function parseAssTime(value: string): number | null {
  const match = value.trim().match(/^(\d+):(\d{2}):(\d{2})\.(\d{2})$/)
  if (!match) return null
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]) + Number(match[4]) / 100
}

export function parseLyrics(input: string, filename = ''): ParsedLyric[] {
  const lines = input.replace(/^﻿/, '').split(/\r?\n/)
  const extension = filename.toLowerCase().split('.').pop() ?? ''
  const isSrt = extension === 'srt' || /^\s*\d+\s*\r?\n\d{2}:\d{2}:\d{2}[,.]/m.test(input)
  const isAss = ['ass', 'ssa'].includes(extension) || /^Dialogue:/im.test(input)
  const hasLrc = extension === 'lrc' || /^\s*\[\d{1,2}:\d{2}/m.test(input)

  if (isAss) return lines.map(parseAssDialogue).filter((item): item is ParsedLyric => item !== null)

  if (isSrt) {
    const cues = input.trim().split(/\r?\n\s*\r?\n/)
    return cues.flatMap((cue) => {
      const cueLines = cue.split(/\r?\n/)
      const timeLine = cueLines.find((line) => line.includes('-->'))
      if (!timeLine) return []
      const match = timeLine.match(/(\d{2}:\d{2}:\d{2}[,.]\d{1,3})\s*-->\s*(\d{2}:\d{2}:\d{2}[,.]\d{1,3})/)
      if (!match) return []
      const start = parseSubTime(match[1])
      const end = parseSubTime(match[2])
      const text = cueLines.slice(cueLines.indexOf(timeLine) + 1).join(' ').replace(/<[^>]+>/g, '').trim()
      return text && start !== null && end !== null ? [{ text, start, end }] : []
    })
  }

  if (hasLrc) {
    const entries: ParsedLyric[] = []
    for (const line of lines) {
      const matches = [...line.matchAll(/\[(\d{1,2}:\d{2}(?:[.:]\d{1,3})?)\]/g)]
      const text = line.replace(/\[[^\]]+\]/g, '').trim()
      if (!text) continue
      for (const match of matches) {
        const start = parseLrcTime(match[1])
        if (start !== null) entries.push({ text, start })
      }
    }
    entries.sort((a, b) => (a.start ?? 0) - (b.start ?? 0))
    return entries.map((entry, index) => ({
      ...entry,
      end: entries[index + 1]?.start ?? (entry.start ?? 0) + 3.5,
    }))
  }

  return lines.map((line) => line.trim()).filter(Boolean).map((text) => ({ text }))
}

function parseSubTime(value: string): number | null {
  const match = value.match(/^(\d{2}):(\d{2}):(\d{2})[,.](\d{1,3})$/)
  if (!match) return null
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]) + Number(match[4].padEnd(3, '0')) / 1000
}

export function lyricsToSegments(lines: ParsedLyric[], fallbackStart = 0): LyricSegment[] {
  let cursor = fallbackStart
  return lines.map((line) => {
    const start = Math.max(0, line.start ?? cursor)
    const end = Math.max(start + 0.2, line.end ?? start + estimateLineDuration(line.text))
    cursor = end + 0.28
    return {
      id: makeId(),
      text: line.text,
      start,
      end,
      speakerRole: 'unknown' as SpeakerRole,
      words: line.words ?? [],
      needsReview: !line.words?.length,
    }
  })
}

function estimateLineDuration(text: string): number {
  const syllables = Math.max(1, text.trim().split(/\s+/).length)
  return Math.max(1.7, Math.min(6.5, syllables * 0.48))
}

function normalize(value: string): string {
  return value.toLocaleLowerCase('vi').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim()
}

function overlapScore(a: string, b: string): number {
  const first = new Set(normalize(a).split(' ').filter(Boolean))
  const second = new Set(normalize(b).split(' ').filter(Boolean))
  if (first.size === 0 || second.size === 0) return 0
  let common = 0
  for (const token of first) if (second.has(token)) common += 1
  return common / Math.max(first.size, second.size)
}

export function alignLyrics(lines: ParsedLyric[], transcript: NormalizedTranscript): LyricSegment[] {
  if (!lines.length) {
    return transcript.segments.map((item) => ({
      ...item,
      speakerRole: 'unknown',
      providerSpeakerId: item.speakerId,
      needsReview: (item.confidence ?? 1) < 0.7,
    }))
  }
  const used = new Set<number>()
  let lowerBound = 0
  return lines.map((line) => {
    let bestIndex = -1
    let bestScore = 0
    for (let index = lowerBound; index < transcript.segments.length; index += 1) {
      if (used.has(index)) continue
      const score = overlapScore(line.text, transcript.segments[index].text)
      if (score > bestScore) {
        bestScore = score
        bestIndex = index
      }
    }
    const matched = bestIndex >= 0 && bestScore >= 0.24 ? transcript.segments[bestIndex] : undefined
    if (matched && bestIndex >= 0) {
      used.add(bestIndex)
      lowerBound = bestIndex
    }
    const start = matched?.start ?? line.start ?? (transcript.segments.at(-1)?.end ?? 0)
    const end = matched?.end ?? line.end ?? start + estimateLineDuration(line.text)
    return {
      id: makeId(),
      text: line.text,
      start,
      end: Math.max(start + 0.2, end),
      speakerRole: 'unknown',
      providerSpeakerId: matched?.speakerId,
      words: matched?.words ?? line.words ?? [],
      confidence: matched?.confidence,
      needsReview: !matched || (matched.confidence ?? 1) < 0.68,
    }
  })
}
