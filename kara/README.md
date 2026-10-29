# Kara Studio

Windows-first lyric timing editor for karaoke subtitles.

## Requirements

- Node.js 20.19+ (tested with Node 24)
- Windows 10/11

No C++ build tools or native audio modules are required. The desktop package uses Electron and `electron-packager` rather than NSIS/symlink-based installer tooling.

## Quick karaoke workflow

1. Import a full vocal track, or import a video from **Hình nền**. For desktop video projects, use **Trích audio từ video** to create a separate WAV for playback and local recognition.
2. Import prepared lyrics as TXT/LRC/SRT/ASS, or select **Nhận dạng** to run the configured local Whisper model. **Demo offline** only creates sample/estimated timing; it does not listen to the song.
3. Use **Đồng bộ track** to choose the audio used for analysis, playback and final render. Check every item in **Cần nghe xác nhận** by playing its slow loop; timing or text edits return affected lines to review.
4. Adjust line and word timing in the timeline or record words with the playback controls. Lock timing that has been checked.
5. Set lyric position and preview width, then render the MP4 or export SRT/ASS. The preview width is independent of the rendered output resolution.

Drag the thin dividers beside the source and properties panels to adjust their widths. Use the arrow keys when a divider is focused, or double-click it to restore its default width; both widths are saved between sessions.

## Run in browser

```bash
npm install
npm run dev
```

Browser preview supports local audio/lyrics import, manual timing edits, demo timing, project JSON download, SRT/ASS download, and the live karaoke preview. Drag the lyric block in the preview stage, use the arrow keys after focusing it, or edit the X/Y percentage fields; these changes are saved in the project and participate in undo/redo. Browser mode cannot render an MP4 because FFmpeg, local paths, and save dialogs remain inside Electron.

## Preview and render video

The preview follows the same HTML audio clock used by the transport. It highlights the active lyric line and, when word timing exists, the current word. The lyric anchor is normalized to the video frame, so its position remains consistent between the preview and the generated ASS subtitles. The preview also exposes output resolution presets/custom dimensions and the background color used for generated backgrounds and video padding.

Import a video from **Hình nền** to preview it and use it as the render background. If Chromium cannot decode the source, desktop mode creates a cached 640×360 H.264/AAC preview proxy while keeping the original video for final rendering. In desktop mode, **Trích audio từ video** creates a WAV track that can be played, analyzed locally, aligned, and selected for render. Without extraction, the video's own audio can still play/render when there are no separate audio tracks. The **Đồng bộ track** panel lets you choose analysis, playback and render sources independently and add timestamp anchors to align offset or tempo drift. The preview size can be changed independently with its width field or slider; height follows the selected output aspect ratio.

Rendering uses the configured frame size and background, burns ASS karaoke subtitles, and encodes H.264 video with AAC audio in a fast-start MP4. A missing FFmpeg executable or required `subtitles`, `libx264`, or `aac` capability is reported as a safe application error rather than executing a fallback download.

## Run desktop app

```bash
npm install
npm run desktop:dev
```

The renderer can play MP3, WAV, M4A, AAC, FLAC, OGG and WebM formats supported by Chromium. The local Whisper source preference selects the analysis track by default; the **Đồng bộ track** panel can explicitly choose another analysis asset. All chosen sources remain separate assets and are mapped to the project timeline.

## Build and package for Windows

```bash
npm run typecheck
npm test
npm run desktop:dist
```

The unpacked app is written under `release/KaraStudio-win32-x64`. `electron-packager` is used to avoid NSIS/winCodeSign symlink requirements on restricted Windows machines. The `desktop:dist` script unpacks `node_modules/ffmpeg-static` into the packaged `app.asar.unpacked` directory so the executable can be spawned without running a binary from inside ASAR.

`ffmpeg-static` is pinned to version 5.3.0. It supplies the FFmpeg binary used by the desktop renderer; verify the binary's included codecs and filters before distributing a build. FFmpeg is licensed under GPL-3.0-or-later in this dependency, so redistributed Kara Studio packages must preserve the applicable FFmpeg license and source/offer obligations. The app does not download a replacement binary at runtime.

## Recognition providers

The offline demo never sends audio. **Whisper local** runs in a separate Python worker. With supplied lyrics, Stable-ts aligns each lyric word directly against the selected audio, following Vietkara. Without lyrics, Faster-Whisper transcribes and returns word-level timestamps. The worker expects Python 3.10–3.12 plus Faster-Whisper and Stable-ts, and can use a model name (`tiny`, `base`, `small`, `medium`, or `large-v3-turbo`) or a local model directory. Large-v3-turbo is best supplied as a local model directory; it is heavier than medium and remains subject to CPU/GPU memory. The reproducible Windows x64 CPU setup is Python 3.12.10 with pinned dependencies from `runtime/windows-python312-cpu-requirements.lock.txt`:

```powershell
.\scripts\setup-local-runtime.ps1
```

If Python 3.12 is installed outside the Python launcher, pass its executable explicitly: `.\scripts\setup-local-runtime.ps1 -PythonPath 'C:\Path\To\Python312\python.exe'`. Python 3.15 is outside the tested range and currently lacks compatible PyAV wheels for this dependency set; pip then falls back to compiling old PyAV sources and can fail in Cython. Keep 3.15 installed if you need it; install 3.12 side by side for Kara Studio. Then select `.venv-kara\Scripts\python.exe` in Kara Studio's local recognition settings and run **Kiểm tra runtime**. This clean-venv installation and worker health check were verified on Windows x64; a real 45-second song excerpt also produced word timestamps on CPU. Python 3.10/3.11, other operating systems, GPU inference and transcript accuracy are not covered by this profile. The worker has a compatibility adapter for PyAV 19, whose release removed metadata arguments used by Faster-Whisper 1.2.1.

To separate a full mix into vocal and instrumental stems, install optional `demucs` into the same Python environment (`python -m pip install demucs`) and use **Tách vocal + beat** under the audio sources. Separation runs locally, keeps both WAV stems in the app cache, and selects vocal for analysis and instrumental for render. Demucs may download its pretrained model the first time it runs; install the model/cache beforehand for offline use.

Select **Whisper local** in Recognition settings, choose the language (for Vietnamese use `vi`), and run **Căn timestamp local**. The first model load may download several hundred MB to the Faster-Whisper/Hugging Face cache. For a packaged offline deployment, provide a verified Python/worker runtime and model separately; the current Electron package intentionally does not embed multi-GB model weights. If the runtime or model is missing, the app reports that explicitly instead of falling back to fake timestamps.

After recognition, lines with ASR word timestamps stay in **Cần nghe xác nhận** even when their lyric text matches: ASR text confidence does not certify karaoke onset/offset accuracy. Estimated timings and empty word timings are marked separately. The review queue can play a line in a slow loop, then confirm it or explicitly accept it as a draft; preview/render can also be used before review to inspect drafts. Each word shows its timing source (ASR, experimental alignment, estimate, or manual). Editing a line returns it to review. Offline demo timing is an estimate for trying the UI and is never treated as verified audio timing.

In desktop mode, use **Kiểm tra runtime** in the local provider settings before transcribing. It reports the selected Python executable/version, Faster-Whisper, Stable-ts, optional Demucs and CUDA availability. This check does not load model weights or read audio. If multiple Python installations are present, set **Python executable** to the interpreter in the environment containing the required packages; the same interpreter is used for subsequent recognition and cache separation.

With supplied lyrics, direct alignment does not run ASR first to rewrite them. Invalid, collapsed, or mismatched alignment fails without replacing the current project timings. Without supplied lyrics, Faster-Whisper returns a draft transcript that remains in the review queue until heard and confirmed.

Recognition has no third-party API endpoint configuration and the app does not load fonts or send media to a remote service. Existing projects that selected an online provider open with **Demo offline**; saved endpoint and credential settings are removed when desktop settings are migrated. Whisper local analyzes audio on the computer. Its model may still need a one-time download unless installed locally.

## Project portability

Project files use the `.kara.json` extension and reference media by absolute path. Moving a project to another computer requires relinking the referenced audio and lyrics. Secrets are never written into project JSON.


## Vietkara workflow integration

The main workspace now keeps pasted lyrics beside the preview, playback controls below them, and a separately scrolling timing list. Select a line to open its inspector; drag a word body to move it or its left/right edge to adjust onset/offset. Advanced video and track settings are collapsed. Preview/export remain available for drafts.

With supplied lyrics, the worker uses Stable-ts 2.19.1 `load_faster_whisper().align()` with `original_split=True` and speech VAD disabled, following the user-provided Vietkara worker. Sustained near-silence is trimmed with its offset restored. Prefix ASR rescue requires a matching phrase. Collapsed/invalid alignment fails before replacing project timings. The full lyrics are passed through a temporary UTF-8 file, including when longer than 4,000 characters. SRT/LRC/ASS markup is parsed before alignment; successful direct timings are not rematched against ASR in the renderer. Without lyrics, Faster-Whisper transcribes normally.

Install Stable-ts in the selected Python environment (`python -m pip install stable-ts==2.19.1`) or run the updated setup script. Runtime settings show Stable-ts availability and provide Python/model file pickers. A model directory may be reused from an existing local installation. The default new project uses local recognition and contains no demonstration lyrics.

Local validation on a 278.717-second sung track returned 54 lyric lines / 312 words, with 4 words marked estimated and no invalid or overlapping intervals. This is an integration/structure check, not a measured onset/offset accuracy score.
