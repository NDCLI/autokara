export type CachedTranscript = {
  segments: Array<{ id: string; text: string; start: number; end: number; words: Array<{ id: string; text: string; start: number; end: number }> }>
  duration?: number
  timingMethod?: 'asr' | 'direct-lyrics-alignment'
  device?: 'cpu' | 'cuda'
  deviceFallbackReason?: string
}

export function createTranscriptionCache(options: { directory: string; maxEntries?: number; maxBytes?: number }): {
  keyFor(audioPath: string, profile: Record<string, unknown>, lyricsText?: string, credentialScope?: string, engineVersion?: string): Promise<string>
  read(key: string): Promise<CachedTranscript | null>
  write(key: string, result: CachedTranscript): Promise<void>
}
