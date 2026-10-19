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

function karaokeText(segment: LyricSegment, enabled: boolean): string {
  if (!enabled || segment.words.length === 0) return assEscape(segment.text)
  return segment.words
    .map((word) => {
      const duration = Math.max(1, Math.round((word.end - word.start) * 100))
      return `{\\k${duration}}${assEscape(word.text)}`
    })
    .join(' ')
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
    const text = `{\\an5\\pos(${Math.round(videoSettings.lyricPosition.x * videoSettings.width)},${Math.round(videoSettings.lyricPosition.y * videoSettings.height)})}${assEscape(prefix)}${karaokeText(segment, options.includeKaraokeTags)}`
    lines.push(`Dialogue: 0,${formatAssTimecode(start)},${formatAssTimecode(end)},${ROLE_STYLE[segment.speakerRole]},,0,0,0,,${text}`)
  }
  return lines.join('\n')
}
