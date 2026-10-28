import type { ExportOptions, LyricSegment, SpeakerRole, VideoSettings } from '../../../shared/contracts'
import { countdownCues } from '../../engine/karaokePresentation'
import { DEFAULT_VIDEO_SETTINGS, SPEAKER_COLORS } from '../../../shared/contracts'
import { formatTimecode } from '../timecode'

const ROLE_PREFIX: Record<SpeakerRole, string> = {
  male: 'NAM: ',
  female: 'NỮ: ',
  duet: 'ĐỐI ĐÁP: ',
  unknown: '',
}

function cleanText(value: string): string {
  return value.replace(/\r?\n/g, ' ').replace(/\s+/g, ' ').trim()
}

export function buildSrt(segments: LyricSegment[], options: ExportOptions): string {
  return segments
    .filter((segment) => segment.text.trim())
    .map((segment, index) => {
      const start = Math.max(0, segment.start - options.leadInMs / 1000)
      const end = Math.max(start + 0.05, segment.end + options.leadOutMs / 1000)
      const prefix = options.includeSpeakerPrefix ? ROLE_PREFIX[segment.speakerRole] : ''
      return `${index + 1}\n${formatTimecode(start)} --> ${formatTimecode(end)}\n${prefix}${cleanText(segment.text)}`
    })
    .join('\n\n')
}

function assEscape(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/[{}]/g, '').replace(/[\u0000-\u001f\u007f]/g, '')
}

function formatAssTimecode(value: number): string {
  const centiseconds = Math.round(Math.max(0, value) * 100)
  const hours = Math.floor(centiseconds / 360000)
  const minutes = Math.floor(centiseconds / 6000) % 60
  const seconds = Math.floor(centiseconds / 100) % 60
  const fraction = centiseconds % 100
  return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(fraction).padStart(2, '0')}`
}

function karaokeText(segment: LyricSegment, enabled: boolean, dialogueStart = segment.start): string {
  if (!enabled || segment.words.length === 0) return assEscape(segment.text)
  const words = [...segment.words]
    .map((word) => ({
      ...word,
      start: Math.max(dialogueStart, Math.min(segment.end, word.start)),
      end: Math.max(segment.start, Math.min(segment.end, word.end)),
    }))
    .filter((word) => word.text.trim() && word.end > word.start)
    .sort((a, b) => a.start - b.start || a.end - b.end)
  if (!words.length) return assEscape(segment.text)
  let cursor = Math.round(dialogueStart * 100)
  return words.map((word, index) => {
    const effectiveStart = Math.max(cursor, Math.round(word.start * 100))
    const end = Math.max(effectiveStart + 1, Math.round(word.end * 100))
    const gap = effectiveStart - cursor
    const duration = end - effectiveStart
    cursor = end
    const separator = index === 0 || gap > 0 ? '' : ' '
    const gapSyllable = gap > 0 ? `{\\k${gap}} ` : ''
    return `${separator}${gapSyllable}{\\kf${duration}}${assEscape(word.text)}`
  }).join('')
}

const ROLE_STYLE: Record<SpeakerRole, string> = {
  male: 'Male',
  female: 'Female',
  duet: 'Duet',
  unknown: 'Default',
}

function assColor(value: string): string {
  const match = value.match(/^#([0-9a-f]{6})$/i)
  if (!match) return '&H00FFFFFF'
  const hex = match[1]
  return `&H00${hex.slice(4, 6)}${hex.slice(2, 4)}${hex.slice(0, 2)}`.toUpperCase()
}

export function buildAss(segments: LyricSegment[], options: ExportOptions, videoSettings: VideoSettings = DEFAULT_VIDEO_SETTINGS): string {
  const lines = [
    '[Script Info]',
    'Title: Kara Studio lyrics',
    'ScriptType: v4.00+',
    'WrapStyle: 2',
    'ScaledBorderAndShadow: yes',
    `PlayResX: ${videoSettings.width}`,
    `PlayResY: ${videoSettings.height}`,
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    `Style: Default,Arial,${Math.round(64 * videoSettings.width / 1920)},&H00FFFFFF,${assColor(SPEAKER_COLORS.unknown)},&H00110B20,&HAA110B20,1,0,1,3,0,2,80,80,70,1`,
    `Style: Male,Arial,${Math.round(64 * videoSettings.width / 1920)},&H00FFFFFF,${assColor(SPEAKER_COLORS.male)},&H00110B20,&HAA110B20,1,0,1,3,0,2,80,80,70,1`,
    `Style: Female,Arial,${Math.round(64 * videoSettings.width / 1920)},&H00FFFFFF,${assColor(SPEAKER_COLORS.female)},&H00110B20,&HAA110B20,1,0,1,3,0,2,80,80,70,1`,
    `Style: Duet,Arial,${Math.round(64 * videoSettings.width / 1920)},&H00FFFFFF,${assColor(SPEAKER_COLORS.duet)},&H00110B20,&HAA110B20,1,0,1,3,0,2,80,80,70,1`,
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ]
  const ordered = segments.filter((segment) => segment.text.trim()).slice().sort((a, b) => a.start - b.start || a.end - b.end)
  const x = Math.round(videoSettings.lyricPosition.x * videoSettings.width)
  const y = Math.round(videoSettings.lyricPosition.y * videoSettings.height)
  const teaserY = Math.max(0, Math.round(y - videoSettings.height * 0.075))
  for (let index = 0; index < ordered.length; index += 1) {
    const segment = ordered[index]
    if (!segment.text.trim()) continue
    const start = Math.max(0, segment.start - options.leadInMs / 1000)
    const end = Math.max(start + 0.05, segment.end + options.leadOutMs / 1000)
    const prefix = options.includeSpeakerPrefix ? ROLE_PREFIX[segment.speakerRole] : ''
    const text = `{\\an5\\pos(${x},${y})}${assEscape(prefix)}${karaokeText(segment, options.includeKaraokeTags, start)}`
    lines.push(`Dialogue: 0,${formatAssTimecode(start)},${formatAssTimecode(end)},${ROLE_STYLE[segment.speakerRole]},,0,0,0,,${text}`)

    const next = ordered[index + 1]
    if (next && next.start > segment.start) {
      const teaserStart = Math.max(0, segment.start - options.leadInMs / 1000)
      const teaserEnd = Math.max(teaserStart + 0.05, Math.min(segment.end, next.start - 0.01) + options.leadOutMs / 1000)
      if (teaserEnd > teaserStart) {
        const nextPrefix = options.includeSpeakerPrefix ? ROLE_PREFIX[next.speakerRole] : ''
        const teaser = `{\\an5\\pos(${x},${teaserY})\\alpha&H50&}${assEscape(nextPrefix + cleanText(next.text))}`
        lines.push(`Dialogue: 1,${formatAssTimecode(teaserStart)},${formatAssTimecode(teaserEnd)},${ROLE_STYLE[next.speakerRole]},,0,0,0,,${teaser}`)
      }
      for (const cue of countdownCues(segment, next, options.leadInMs, options.leadOutMs)) {
        const text = `{\\an5\\pos(${x},${teaserY})\\alpha&H20&\\fs${Math.max(20, Math.round(70 * videoSettings.width / 1920))}}${cue.value}`
        lines.push(`Dialogue: 2,${formatAssTimecode(cue.start)},${formatAssTimecode(cue.end)},${ROLE_STYLE[next.speakerRole]},,0,0,0,,${text}`)
      }
    }
  }
  return lines.join('\n')
}
