import type { KaraProject, NormalizedTranscript, ProviderProfile } from '../../../shared/contracts'
import { mockTranscriptFromLyrics } from '../lyrics/align'
import { normalizeCustomResponse, normalizeDeepgramResponse } from './normalize'

export async function runBrowserProvider(profile: ProviderProfile, audio: File, lyricsText?: string): Promise<NormalizedTranscript> {
  if (profile.kind === 'mock') {
    const lines = lyricsText?.split(/\r?\n/).filter(Boolean).map((text) => ({ text })) ?? [{ text: 'Chưa có lời để mô phỏng timing' }]
    return mockTranscriptFromLyrics(lines)
  }
  throw new Error('Provider cloud chỉ chạy qua Electron để giữ API key ngoài renderer.')
}

export type ProviderRun = { profile: ProviderProfile; project: KaraProject; audioPath: string; lyricsText?: string }

export { normalizeCustomResponse, normalizeDeepgramResponse }
