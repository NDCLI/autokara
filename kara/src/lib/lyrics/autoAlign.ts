import type { LyricSegment, NormalizedTranscript, ReviewReason, TimedWord, TimingOrigin } from '../../../shared/contracts'
import type { ParsedLyric } from './parse'

function normalizeToken(value: string): string {
  return value.toLocaleLowerCase('vi').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/[^a-z0-9]/g, '')
}

function tokens(value: string): string[] {
  return value.trim().split(/\s+/).map(normalizeToken).filter(Boolean)
}

function tokenSimilarity(left: string, right: string): number {
  if (left === right) return 1
  if (Math.min(left.length, right.length) < 4) return 0
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index)
  for (let row = 1; row <= left.length; row += 1) {
    const current = new Array<number>(right.length + 1)
    current[0] = row
    for (let column = 1; column <= right.length; column += 1) {
      current[column] = Math.min(previous[column] + 1, current[column - 1] + 1, previous[column - 1] + (left[row - 1] === right[column - 1] ? 0 : 1))
    }
    previous = current
  }
  return 1 - previous[right.length] / Math.max(left.length, right.length)
}

function isSafeApproximateMatch(left: string, right: string): boolean {
  return left !== right && tokenSimilarity(left, right) >= 0.72
}

type TokenTiming = { token: string; start: number; end: number; confidence?: number; origin?: TimingOrigin; speakerId?: string; approximate?: boolean }

type TokenWindow = { start: number; end: number; cost: number; matches: number }

function intervalDistance(start: number, end: number, anchorStart?: number, anchorEnd?: number): number {
  if (anchorStart === undefined && anchorEnd === undefined) return 0
  const targetStart = anchorStart ?? anchorEnd!
  const targetEnd = anchorEnd ?? anchorStart!
  if (end < targetStart) return targetStart - end
  if (start > targetEnd) return start - targetEnd
  return 0
}

function bestTokenWindow(expected: string[], actual: TokenTiming[], cursor: number, anchorStart?: number, anchorEnd?: number): TokenWindow | undefined {
  if (!expected.length || cursor >= actual.length) return undefined
  const source = actual.slice(cursor)
  const width = source.length + 1
  const steps = new Uint8Array((expected.length + 1) * width)
  let previous = new Float64Array(width)
  for (let row = 1; row <= expected.length; row += 1) steps[row * width] = 1
  for (let row = 1; row <= expected.length; row += 1) {
    const current = new Float64Array(width)
    current[0] = row * 0.7
    for (let column = 1; column < width; column += 1) {
      const similarity = tokenSimilarity(expected[row - 1], source[column - 1].token)
      const substitution = previous[column - 1] + (expected[row - 1] === source[column - 1].token ? 0 : similarity >= 0.72 ? 0.45 : 1.5)
      const deletion = previous[column] + 0.7
      const insertion = current[column - 1] + 0.7
      let best = substitution
      let step = 0
      if (deletion < best) { best = deletion; step = 1 }
      if (insertion < best) { best = insertion; step = 2 }
      current[column] = best
      steps[row * width + column] = step
    }
    previous = current
  }

  let minimumCost = Number.POSITIVE_INFINITY
  for (const value of previous) minimumCost = Math.min(minimumCost, value)
  let bestWindow: TokenWindow | undefined
  let bestDistance = Number.POSITIVE_INFINITY
  for (let end = 1; end < width; end += 1) {
    if (previous[end] > minimumCost + 0.0001) continue
    let row = expected.length
    let column = end
    let matches = 0
    while (row > 0 && column > 0) {
      const step = steps[row * width + column]
      if (step === 0) {
        matches += tokenSimilarity(expected[row - 1], source[column - 1].token)
        row -= 1
        column -= 1
      }
      else if (step === 1) row -= 1
      else column -= 1
    }
    const start = cursor + column
    const absoluteEnd = cursor + end
    const distance = start >= absoluteEnd
      ? Number.POSITIVE_INFINITY
      : intervalDistance(actual[start].start, actual[absoluteEnd - 1].end, anchorStart, anchorEnd)
    if (!bestWindow || distance < bestDistance || (distance === bestDistance && absoluteEnd < bestWindow.end)) {
      bestWindow = { start, end: absoluteEnd, cost: previous[end], matches }
      bestDistance = distance
    }
  }
  return bestWindow
}

function alignTokenTimings(expected: string[], words: TimedWord[]): Array<TokenTiming | undefined> {
  const actual = words.flatMap((word) => tokens(word.text).map((token) => ({
    token,
    start: word.start,
    end: word.end,
    confidence: word.confidence,
    origin: word.origin,
  })))
  const rows = expected.length + 1
  const columns = actual.length + 1
  const cost = Array.from({ length: rows }, () => new Float64Array(columns))
  const step = Array.from({ length: rows }, () => new Uint8Array(columns))
  for (let row = 1; row < rows; row += 1) { cost[row][0] = row; step[row][0] = 1 }
  for (let column = 1; column < columns; column += 1) { cost[0][column] = column; step[0][column] = 2 }

  for (let row = 1; row < rows; row += 1) {
    for (let column = 1; column < columns; column += 1) {
      const similarity = tokenSimilarity(expected[row - 1], actual[column - 1].token)
      const substitution = cost[row - 1][column - 1] + (expected[row - 1] === actual[column - 1].token ? 0 : similarity >= 0.72 ? 0.45 : 1)
      const deletion = cost[row - 1][column] + 1
      const insertion = cost[row][column - 1] + 1
      if (substitution <= deletion && substitution <= insertion) {
        cost[row][column] = substitution
        step[row][column] = 0
      } else if (deletion <= insertion) {
        cost[row][column] = deletion
        step[row][column] = 1
      } else {
        cost[row][column] = insertion
        step[row][column] = 2
      }
    }
  }

  const aligned: Array<TokenTiming | undefined> = new Array(expected.length)
  let row = expected.length
  let column = actual.length
  while (row > 0 || column > 0) {
    const operation = step[row][column]
    if (row > 0 && column > 0 && operation === 0) {
      if (expected[row - 1] === actual[column - 1].token) aligned[row - 1] = actual[column - 1]
      else if (isSafeApproximateMatch(expected[row - 1], actual[column - 1].token)) aligned[row - 1] = { ...actual[column - 1], approximate: true }
      row -= 1
      column -= 1
    } else if (row > 0 && (column === 0 || operation === 1)) row -= 1
    else column -= 1
  }
  return aligned
}

type SheetTokenMatch = { index: number; token: TokenTiming }

/** Aligns the whole unanchored lyric sheet in one pass so repeated phrases cannot jump ahead independently. */
function alignUnanchoredSheet(lines: ParsedLyric[], sourceTokens: TokenTiming[]): Array<Array<SheetTokenMatch | undefined>> | undefined {
  if (!lines.length || lines.some((line) => line.start !== undefined || line.end !== undefined || line.words?.length)) return undefined
  const expectedByLine = lines.map((line) => tokens(line.text))
  const expected = expectedByLine.flat()
  const aligned = alignTokenTimings(expected, sourceTokens.map((word, index) => ({
    id: `sheet-${index}`,
    text: word.token,
    start: word.start,
    end: word.end,
    confidence: word.confidence,
    origin: word.origin,
  })))
  const rows: Array<Array<SheetTokenMatch | undefined>> = new Array(lines.length)
  let offset = 0
  let searchFrom = 0
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const count = expectedByLine[lineIndex].length
    const indices: Array<SheetTokenMatch | undefined> = []
    for (const matched of aligned.slice(offset, offset + count)) {
      if (!matched) { indices.push(undefined); continue }
      let sourceIndex = searchFrom
      while (sourceIndex < sourceTokens.length && (sourceTokens[sourceIndex].token !== matched.token
        || sourceTokens[sourceIndex].start !== matched.start || sourceTokens[sourceIndex].end !== matched.end)) sourceIndex += 1
      if (sourceIndex < sourceTokens.length) {
        indices.push({ index: sourceIndex, token: sourceTokens[sourceIndex] })
        searchFrom = sourceIndex + 1
      } else indices.push(undefined)
    }
    rows[lineIndex] = indices
    offset += count
  }
  return rows
}

/** Uses time anchors to divide very long lyric sheets into independent DP windows. */
function alignLongAnchoredLyrics(lines: ParsedLyric[], sourceTokens: TokenTiming[]): Array<TokenWindow | undefined> | undefined {
  const anchors = lines.map((line, index) => ({ index, start: line.start, end: line.end }))
    .filter((anchor): anchor is { index: number; start: number; end: number } => anchor.start !== undefined && anchor.end !== undefined)
  if (lines.length < 120 || anchors.length < 2) return undefined
  const windows: Array<TokenWindow | undefined> = new Array(lines.length)
  // Construct monotonic token boundaries by splitting the transcript at temporal midpoints.
  const boundaries = [0, ...anchors.map((anchor) => {
    let position = 0
    while (position < sourceTokens.length && sourceTokens[position].start < anchor.start) position += 1
    return position
  }), sourceTokens.length]
  const lineBoundaries = [0, ...anchors.map((anchor) => anchor.index), lines.length]
  for (let group = 0; group < lineBoundaries.length - 1; group += 1) {
    const lineStart = lineBoundaries[group]
    const lineEnd = lineBoundaries[group + 1]
    const tokenStart = boundaries[group]
    const tokenEnd = boundaries[group + 1]
    const expected = lines.slice(lineStart, lineEnd).flatMap((line) => tokens(line.text))
    const actual = sourceTokens.slice(tokenStart, tokenEnd)
    const aligned = alignTokenTimings(expected, actual.map((word) => ({ id: `tmp-${word.start}`, text: word.token, start: word.start, end: word.end, confidence: word.confidence, origin: word.origin })))
    let offset = 0
    for (let lineIndex = lineStart; lineIndex < lineEnd; lineIndex += 1) {
      const count = tokens(lines[lineIndex].text).length
      const matched = aligned.slice(offset, offset + count).filter(Boolean) as TokenTiming[]
      if (matched.length) {
        const first = sourceTokens.findIndex((word, tokenIndex) => tokenIndex >= tokenStart && word.token === matched[0].token && word.start === matched[0].start)
        let last = first
        for (let tokenIndex = tokenEnd - 1; tokenIndex >= tokenStart; tokenIndex -= 1) {
          if (sourceTokens[tokenIndex].token === matched.at(-1)!.token && sourceTokens[tokenIndex].start === matched.at(-1)!.start) { last = tokenIndex; break }
        }
        windows[lineIndex] = { start: first, end: last + 1, cost: 0, matches: matched.length }
      }
      offset += count
    }
  }
  return windows
}

function repairWords(words: TimedWord[], start: number, end: number, lyricText: string, segmentId: string): TimedWord[] {
  const expected = lyricText.trim().split(/\s+/).filter(Boolean)
  if (!expected.length) return []
  const boundedStart = Math.max(0, start)
  const boundedEnd = Math.max(boundedStart + 0.2, end)
  const minimumWordDuration = Math.min(0.01, (boundedEnd - boundedStart) / expected.length)
  const aligned = alignTokenTimings(expected.map(normalizeToken), words)
  const result: TimedWord[] = expected.map((text, index) => {
    const source = aligned[index]
    let sharedStart = index
    let sharedEnd = index + 1
    if (source) {
      while (sharedStart > 0 && aligned[sharedStart - 1]
        && Math.abs(aligned[sharedStart - 1]!.start - source.start) < 0.005
        && Math.abs(aligned[sharedStart - 1]!.end - source.end) < 0.005) sharedStart -= 1
      while (sharedEnd < aligned.length && aligned[sharedEnd]
        && Math.abs(aligned[sharedEnd]!.start - source.start) < 0.005
        && Math.abs(aligned[sharedEnd]!.end - source.end) < 0.005) sharedEnd += 1
    }
    const sharesTiming = sharedEnd - sharedStart > 1
    let previousIndex = index - 1
    while (previousIndex >= 0 && !aligned[previousIndex]) previousIndex -= 1
    let nextIndex = index + 1
    while (nextIndex < aligned.length && !aligned[nextIndex]) nextIndex += 1
    const previous = previousIndex >= 0 ? aligned[previousIndex] : undefined
    const next = nextIndex < aligned.length ? aligned[nextIndex] : undefined
    if (sharesTiming) {
      const previousDifferent = sharedStart > 0 ? aligned[sharedStart - 1] : undefined
      const nextDifferent = sharedEnd < aligned.length ? aligned[sharedEnd] : undefined
      const sharedIntervalStart = Math.max(boundedStart, source!.start, previousDifferent?.end ?? boundedStart)
      const sharedIntervalEnd = Math.min(boundedEnd, source!.end, nextDifferent?.start ?? boundedEnd)
      const slotWidth = Math.max(minimumWordDuration, sharedIntervalEnd - sharedIntervalStart) / (sharedEnd - sharedStart)
      const wordStart = sharedIntervalStart + slotWidth * (index - sharedStart)
      const wordEnd = index === sharedEnd - 1 ? sharedIntervalEnd : sharedIntervalStart + slotWidth * (index - sharedStart + 1)
      const safeStart = Math.max(boundedStart, Math.min(boundedEnd - minimumWordDuration, wordStart))
      const safeEnd = Math.min(boundedEnd, Math.max(safeStart + minimumWordDuration, wordEnd))
      return {
        id: `${segmentId}-word-${index + 1}`,
        text,
        start: safeStart,
        end: safeEnd,
        confidence: Math.min(source!.confidence ?? 0.25, source!.approximate ? 0.35 : 0.45),
        origin: 'estimated',
      }
    }
    const intervalStart = Math.max(boundedStart, previous?.end ?? boundedStart)
    const intervalEnd = Math.min(boundedEnd, next?.start ?? boundedEnd)
    const missingCount = nextIndex - previousIndex - 1
    const missingOffset = index - previousIndex - 1
    const slotStart = intervalStart + (intervalEnd - intervalStart) * missingOffset / missingCount
    const slotEnd = intervalStart + (intervalEnd - intervalStart) * (missingOffset + 1) / missingCount
    const wordStart = source
      ? Math.max(intervalStart, Math.min(intervalEnd - 0.01, source.start))
      : Math.max(intervalStart, Math.min(intervalEnd - 0.01, slotStart))
    const wordEnd = source
      ? Math.max(wordStart + 0.01, Math.min(intervalEnd, source.end))
      : Math.max(wordStart + 0.01, Math.min(intervalEnd, slotEnd))
    const safeStart = Math.max(boundedStart, Math.min(boundedEnd - minimumWordDuration, wordStart))
    const safeEnd = Math.min(boundedEnd, Math.max(safeStart + minimumWordDuration, wordEnd))
    const adjusted = Boolean(source && (Math.abs(safeStart - source.start) > 0.005 || Math.abs(safeEnd - source.end) > 0.005))
    return {
      id: `${segmentId}-word-${index + 1}`,
      text,
      start: safeStart,
      end: safeEnd,
      confidence: adjusted || source?.approximate ? Math.min(source?.confidence ?? 0.25, source?.approximate ? 0.35 : 0.45) : source?.confidence ?? 0.25,
      origin: adjusted || source?.approximate ? 'estimated' : source ? source.origin ?? 'asr' : 'estimated',
    }
  })
  const invalidOrder = result.some((word, index) => word.start < boundedStart || word.end > boundedEnd
    || (index > 0 && word.start < result[index - 1].end - 0.001))
  if (!invalidOrder) return result
  const slot = (boundedEnd - boundedStart) / expected.length
  return expected.map((text, index) => ({
    id: `${segmentId}-word-${index + 1}`,
    text,
    start: boundedStart + slot * index,
    end: index === expected.length - 1 ? boundedEnd : boundedStart + slot * (index + 1),
    confidence: 0.25,
    origin: 'estimated',
  }))
}

/** Aligns supplied lyrics to monotonic ASR words while preserving lyric display text. */
export function alignTranscriptToLyrics(lines: ParsedLyric[], transcript: NormalizedTranscript, onMatch?: (match: { lineIndex: number; start: number; end: number }) => void): LyricSegment[] {
  if (!lines.length) return transcript.segments.map((item) => ({ ...item, speakerRole: 'unknown', providerSpeakerId: item.speakerId, needsReview: (item.confidence ?? 1) < 0.68 }))
  let cursor = 0
  const sourceTokens = transcript.segments.flatMap((segment) => segment.words.flatMap((word) => tokens(word.text).map((token) => ({
    token,
    start: word.start,
    end: word.end,
    confidence: word.confidence,
    speakerId: segment.speakerId,
    origin: word.origin,
  })))).sort((a, b) => a.start - b.start || a.end - b.end)
  const unanchoredKeysBefore = new Set<string>()
  const anchoredOccurrences = lines.flatMap((line, lineIndex) => {
    const lineTokens = tokens(line.text)
    const key = lineTokens.join(' ')
    if (line.start === undefined && line.end === undefined) {
      unanchoredKeysBefore.add(key)
      return []
    }
    if (!unanchoredKeysBefore.has(key)) return []
    const window = bestTokenWindow(lineTokens, sourceTokens, 0, line.start, line.end)
    if (!window) return []
    const matchedTokens = sourceTokens.slice(window.start, window.end)
    const score = window.matches / Math.max(lineTokens.length, matchedTokens.length, 1)
    if (score < 0.32) return []
    return [{ lineIndex, key, start: window.start, end: window.end }]
  })
  const longAnchoredWindows = alignLongAnchoredLyrics(lines, sourceTokens)
  const wholeSheetMatches = alignUnanchoredSheet(lines, sourceTokens)
  let fallbackEnd = 0
  return lines.map((line, index) => {
    const expected = tokens(line.text)
    const proposedWindow = longAnchoredWindows?.[index]
    const candidateWindow = proposedWindow && proposedWindow.start >= cursor
      ? proposedWindow
      : wholeSheetMatches ? undefined : bestTokenWindow(expected, sourceTokens, cursor, line.start, line.end)
    const reservedForFutureAnchor = candidateWindow
      && line.start === undefined && line.end === undefined
      && anchoredOccurrences.some((occurrence) => occurrence.lineIndex > index
        && occurrence.key === expected.join(' ')
        && candidateWindow.start < occurrence.end
        && candidateWindow.end > occurrence.start)
    const window = reservedForFutureAnchor ? undefined : candidateWindow
    const sheetRow = wholeSheetMatches?.[index]
    const sheetTokens = sheetRow?.flatMap((match) => match ? [match.token] : []) ?? []
    const windowTokens = sheetRow ? sheetTokens : window ? sourceTokens.slice(window.start, window.end) : []
    const matchedCount = sheetRow ? sheetTokens.length : window?.matches ?? 0
    const bestScore = matchedCount / Math.max(expected.length, sheetRow ? expected.length : (window ? window.end - window.start : 0), 1)
    const matchedTokens = windowTokens.length && bestScore >= 0.32 ? windowTokens : []
    const matched = matchedTokens.length ? {
      start: matchedTokens[0].start,
      end: matchedTokens.at(-1)!.end,
      speakerId: matchedTokens.every((word) => word.speakerId === matchedTokens[0].speakerId) ? matchedTokens[0].speakerId : undefined,
      confidence: matchedTokens.every((word) => word.confidence !== undefined)
        ? matchedTokens.reduce((sum, word) => sum + (word.confidence ?? 0), 0) / matchedTokens.length
        : undefined,
      words: matchedTokens.map((word, tokenIndex) => ({ id: `matched-${index + 1}-${tokenIndex + 1}`, text: word.token, start: word.start, end: word.end, confidence: word.confidence, origin: word.origin })),
    } : undefined
    if (matched) onMatch?.({ lineIndex: index, start: matched.start, end: matched.end })
    if (matched && sheetRow) {
      const matchedIndices = sheetRow.flatMap((match) => match ? [match.index] : [])
      if (matchedIndices.length) cursor = Math.max(cursor, matchedIndices.at(-1)! + 1)
    } else if (matched && window) cursor = window.end
    const proposedStart = matched?.start ?? Math.max(sourceTokens[cursor - 1]?.end ?? 0, fallbackEnd)
    const start = line.start ?? Math.max(proposedStart, wholeSheetMatches ? fallbackEnd : proposedStart)
    const end = line.end ?? matched?.end ?? start + Math.max(1.7, Math.min(6.5, expected.length * 0.48))
    const timingShifted = Boolean(matched && start > matched.start + 0.005)
    if (timingShifted) {
      for (const word of matched!.words) {
        const shift = start - matched!.start
        word.start += shift
        word.end += shift
        word.origin = 'estimated'
        word.confidence = Math.min(word.confidence ?? 0.25, 0.45)
      }
    }
    fallbackEnd = end + (matched ? 0 : 0.18)
    const id = `segment-${index + 1}`
    const words = repairWords(matched?.words ?? line.words ?? [], start, end, line.text, id)
    const origin: TimingOrigin = timingShifted ? 'estimated' : matched
      ? matchedTokens.every((word) => word.origin === 'aligned') ? 'aligned' : matchedTokens.every((word) => word.origin === 'estimated') ? 'estimated' : 'asr'
      : line.start !== undefined || line.end !== undefined || line.words?.length ? 'manual' : 'estimated'
    const directAlignmentIncomplete = transcript.timingMethod === 'direct-lyrics-alignment' && words.some((word) => word.origin !== 'aligned' || (word.confidence ?? 0) < 0.68)
    const reviewReasons: ReviewReason[] = []
    if (words.some((word) => word.origin === 'estimated')) reviewReasons.push('estimated-timing')
    if (timingShifted) reviewReasons.push('estimated-timing')
    if (matched && words.some((word) => word.origin === 'asr' || word.origin === 'aligned')) reviewReasons.push('recognition-timing')
    if (!matched || bestScore < 0.68) reviewReasons.push('low-text-match')
    if (!words.length) reviewReasons.push('empty-timing')
    if (directAlignmentIncomplete) reviewReasons.push('recognition-timing')
    const reasons = [...new Set(reviewReasons)]
    return { id, text: line.text, start, end: Math.max(start + 0.2, end), speakerRole: 'unknown', providerSpeakerId: matched?.speakerId, words, confidence: matched?.confidence ?? (matched ? bestScore : 0.25), needsReview: reasons.length > 0, reviewReason: reasons[0], origin }
  })
}
