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

Browser preview supports local audio/lyrics import, manual timing edits, demo timing, project JSON download, SRT/ASS download, and the live karaoke preview. Drag the lyric block in the preview stage, use the arrow keys after focusing it, or edit the X/Y percentage fields; these changes are saved in the project and participate in undo/redo. Browser mode cannot render an MP4 because FFmpeg, local paths, and save dialogs remain inside Electron.

## Preview and render video

The preview follows the same HTML audio clock used by the transport. It highlights the active lyric line and, when word timing exists, the current word. The lyric anchor is normalized to the video frame, so its position remains consistent between the preview and the generated ASS subtitles. The preview also exposes output resolution presets/custom dimensions and the background color used for generated backgrounds and video padding.

Import a video from **Hình nền** to use it as the render background. If that video contains an audio stream and no full-song or beat track is imported, Kara Studio uses the video's audio for playback and rendering; an imported full-song track takes precedence over the video's audio. When a video has no usable audio, import a separate audio track before rendering.

Rendering uses the configured frame size and background, burns ASS karaoke subtitles, and encodes H.264 video with AAC audio in a fast-start MP4. A missing FFmpeg executable or required `subtitles`, `libx264`, or `aac` capability is reported as a safe application error rather than executing a fallback download.

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

The unpacked app is written under `release/KaraStudio-win32-x64`. `electron-packager` is used to avoid NSIS/winCodeSign symlink requirements on restricted Windows machines. The `desktop:dist` script unpacks `node_modules/ffmpeg-static` into the packaged `app.asar.unpacked` directory so the executable can be spawned without running a binary from inside ASAR.

`ffmpeg-static` is pinned to version 5.3.0. It supplies the FFmpeg binary used by the desktop renderer; verify the binary's included codecs and filters before distributing a build. FFmpeg is licensed under GPL-3.0-or-later in this dependency, so redistributed Kara Studio packages must preserve the applicable FFmpeg license and source/offer obligations. The app does not download a replacement binary at runtime.

## Recognition providers

The offline demo never sends audio. **Whisper local** runs Faster-Whisper in a separate Python worker and returns word-level timestamps from the imported full audio; it does not separate vocals, use UVR/MDX models, or require an API key. The worker currently expects Python 3 plus `faster-whisper` to be installed and can use a model name (`tiny`, `base`, `small`, or `medium`) or a local model directory. For a development setup:

```bash
python -m pip install faster-whisper
```

Select **Whisper local** in Recognition settings, choose the language (for Vietnamese use `vi`), and run **Căn timestamp local**. The first model load may download several hundred MB to the Faster-Whisper/Hugging Face cache. For a packaged offline deployment, provide a verified Python/worker runtime and model separately; the current Electron package intentionally does not embed multi-GB model weights. If the runtime or model is missing, the app reports that explicitly instead of falling back to fake timestamps.

Deepgram and compatible custom HTTP JSON providers run through Electron's main process; API keys are stored outside project files and encrypted with Electron `safeStorage` when available. A custom endpoint receives the selected audio bytes as `application/octet-stream` and should return a JSON object with a `segments` array:

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
