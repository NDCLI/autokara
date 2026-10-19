# Kara Studio

Windows-first lyric timing editor for karaoke subtitles.

## Requirements

- Node.js 20.19+ (tested with Node 24)
- Windows 10/11

No C++ build tools or native audio modules are required. The desktop package uses Electron and `electron-packager` rather than NSIS/symlink-based installer tooling.

## Run in browser

```bash
npm install
npm run dev
```

Browser preview supports local audio/lyrics import, manual timing edits, demo timing, project JSON download, and SRT/ASS download. API providers require the desktop shell.

## Run desktop app

```bash
npm install
npm run desktop:dev
```

The renderer can play MP3, WAV, M4A, AAC, FLAC, OGG and WebM formats supported by Chromium. Import the full song as the transcription source; the beat track is kept as a separate playback/reference track.

## Build and package for Windows

```bash
npm run typecheck
npm test
npm run desktop:dist
```

The unpacked app is written under `release/KaraStudio-win32-x64`. `electron-packager` is used to avoid NSIS/winCodeSign symlink requirements on restricted Windows machines.

## Recognition providers

The offline demo never sends audio. Deepgram and compatible custom HTTP JSON providers run through Electron's main process; API keys are stored outside project files and encrypted with Electron `safeStorage` when available. A custom endpoint receives the selected audio bytes as `application/octet-stream` and should return a JSON object with a `segments` array:

```json
{
  "segments": [
    {
      "text": "Một câu lời hát",
      "start": 1.2,
      "end": 3.8,
      "speaker": "speaker_0",
      "confidence": 0.96,
      "words": [
        { "word": "Một", "start": 1.2, "end": 1.5, "confidence": 0.98 }
      ]
    }
  ]
}
```

The `segments` JSON path can be configured. XPiki is not presented as an STT provider until an audio transcription endpoint and its response shape are confirmed.

## Project portability

Project files use the `.kara.json` extension and reference media by absolute path. Moving a project to another computer requires relinking the referenced audio and lyrics. Secrets are never written into project JSON.
