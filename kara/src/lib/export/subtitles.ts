import type { ExportOptions, LyricSegment, SpeakerRole, VideoSettings } from '../../../shared/contracts'
import { DEFAULT_VIDEO_SETTINGS } from '../../../shared/contracts'
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
  let cursor = dialogueStart
  return words.map((word, index) => {
    const effectiveStart = Math.max(cursor, word.start)
    const gap = Math.max(0, Math.round((effectiveStart - cursor) * 100))
    const end = Math.max(effectiveStart + 0.01, word.end)
    const duration = Math.max(1, Math.round((end - effectiveStart) * 100))
    cursor = Math.max(cursor, end)
    const separator = index === 0 || gap > 0 ? '' : ' '
    const gapSyllable = gap > 0 ? `{\\k${gap}} ` : ''
    return `${separator}${gapSyllable}{\\k${duration}}${assEscape(word.text)}`
  }).join('')
}

const ROLE_STYLE: Record<SpeakerRole, string> = {
  male: 'Male',
  female: 'Female',
  duet: 'Duet',
  unknown: 'Default',
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
    'Style: Default,Arial,64,&H00FFFFFF,&H0000E7FF,&H00110B20,&HAA110B20,1,0,1,3,0,2,80,80,70,1',
    'Style: Male,Arial,64,&H00FFFFFF,&H006D8CFF,&H00110B20,&HAA110B20,1,0,1,3,0,2,80,80,70,1',
    'Style: Female,Arial,64,&H00FFFFFF,&H00F18BCB,&H00110B20,&HAA110B20,1,0,1,3,0,2,80,80,70,1',
    'Style: Duet,Arial,64,&H00FFFFFF,&H00F5C76B,&H00110B20,&HAA110B20,1,0,1,3,0,2,80,80,70,1',
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ]
  for (const segment of segments) {
    if (!segment.text.trim()) continue
    const start = Math.max(0, segment.start - options.leadInMs / 1000)
    const end = Math.max(start + 0.05, segment.end + options.leadOutMs / 1000)
    const prefix = options.includeSpeakerPrefix ? ROLE_PREFIX[segment.speakerRole] : ''
    const text = `{\\an5\\pos(${Math.round(videoSettings.lyricPosition.x * videoSettings.width)},${Math.round(videoSettings.lyricPosition.y * videoSettings.height)})}${assEscape(prefix)}${karaokeText(segment, options.includeKaraokeTags, start)}`
    lines.push(`Dialogue: 0,${formatAssTimecode(start)},${formatAssTimecode(end)},${ROLE_STYLE[segment.speakerRole]},,0,0,0,,${text}`)
  }
  return lines.join('\n')
}
