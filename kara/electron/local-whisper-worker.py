#!/usr/bin/env python3
"""Local word timestamp worker for Kara Studio.

The worker communicates only through JSON lines. It never reads project files or
separation models; audio and an optional Faster-Whisper model path are passed by
the Electron main process.
"""
import argparse
import importlib.metadata
import importlib.util
import json
import math
import os
import sys
from pathlib import Path

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except (AttributeError, OSError):
    pass


_DLL_HANDLES = []

def prepare_cuda_libraries():
    # Same lazy-DLL preparation used by Vietkara; retain Windows directory handles.
    spec = importlib.util.find_spec('torch')
    if not spec or not spec.origin:
        return
    directory = Path(spec.origin).parent / 'lib'
    if directory.is_dir():
        os.environ['PATH'] = str(directory) + os.pathsep + os.environ.get('PATH', '')
        if os.name == 'nt' and hasattr(os, 'add_dll_directory'):
            _DLL_HANDLES.append(os.add_dll_directory(str(directory)))


def supported_python_version(version_info, manifest_path=None):
    path = Path(manifest_path) if manifest_path else Path(__file__).with_name("local-runtime-manifest.json")
    manifest = json.loads(path.read_text(encoding="utf-8"))
    python = manifest["runtime"]["python"]
    minimum = tuple(int(part) for part in python["minimum"].split("."))
    maximum = tuple(int(part) for part in python["maximumExclusive"].split("."))
    current = (int(version_info[0]), int(version_info[1]))
    supported = {tuple(int(part) for part in value.split(".")) for value in python["supported"]}
    return minimum <= current < maximum and current in supported


def emit(value):
    sys.stdout.write(json.dumps(value, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def prepare_faster_whisper_audio_compatibility():
    """Bridge Faster-Whisper 1.2.x to PyAV 19, which removed legacy metadata kwargs."""
    import av

    try:
        av_major = int(av.__version__.split(".", 1)[0])
    except (AttributeError, ValueError):
        return
    if av_major < 19 or getattr(av.open, "_kara_pyav19_compat", False):
        return

    original_open = av.open

    def compatible_open(*args, **kwargs):
        kwargs.pop("metadata_errors", None)
        kwargs.pop("metadata_encoding", None)
        return original_open(*args, **kwargs)

    compatible_open._kara_pyav19_compat = True
    av.open = compatible_open


def enclose_segment_words(start, end, words):
    if not words:
        return start, end
    ordered = sorted(words, key=lambda word: (word["start"], word["end"]))
    return min(start, ordered[0]["start"]), max(end, ordered[-1]["end"])


def repair_prefix(model, samples, words, offset, language):
    """Repair collapsed early tokens only when a local ASR phrase agrees with the supplied lyrics."""
    import difflib
    import re
    import unicodedata
    prefix=words[:40]
    if not any(w['end']-w['start']<.05 for w in prefix):return 0
    segments,_=model.transcribe_original(samples[:16000*30],language=language or 'vi',
                                         word_timestamps=True,beam_size=5,vad_filter=False,
                                         condition_on_previous_text=False,temperature=0.)
    heard=[]
    for segment in segments:
        for item in segment.words or []:
            tokens=item.word.split()
            for j,token in enumerate(tokens):
                heard.append({'text':token,'start':offset+item.start+(item.end-item.start)*j/max(1,len(tokens)),
                              'end':offset+item.start+(item.end-item.start)*(j+1)/max(1,len(tokens))})
    def key(text):return re.sub(r'[^\w]','',unicodedata.normalize('NFC',text).casefold())
    matcher=difflib.SequenceMatcher(None,[key(w['text']) for w in prefix],[key(w['text']) for w in heard],autojunk=False)
    repaired=0
    for block in matcher.get_matching_blocks():
        if block.size<3:continue
        for j in range(block.size):
            i=block.a+j;word=words[i];anchor=heard[block.b+j]
            if word['end']-word['start']>=.05 or abs(anchor['start']-word['start'])>2:continue
            start=max(offset,anchor['start'],words[i-1]['end'] if i else offset)
            end=min(anchor['end'],words[i+1]['start'] if i+1<len(words) else anchor['end'])
            if end-start>=.08:
                word.update(start=float(start),end=float(end),estimated=True)
                repaired+=1
    return repaired

def align_supplied_lyrics(args):
    emit({'type': 'progress', 'phase': 'loading-model', 'percent': 3, 'status': 'Đang chuẩn bị engine căn lời Stable-ts…'})
    import contextlib
    import unicodedata
    import numpy as np
    from faster_whisper.audio import decode_audio
    try:
        import stable_whisper
    except ImportError as error:
        raise RuntimeError("Căn lời như Vietkara cần stable-ts. Cài stable-ts trong Python runtime đang chọn.") from error
    lyrics = Path(args.lyrics_file).read_text(encoding="utf-8-sig").strip()
    lines = [line.split() for line in lyrics.splitlines() if line.strip()]
    if not lines:
        raise RuntimeError("File lời trống.")
    samples = decode_audio(args.audio, sampling_rate=16000)
    duration = len(samples) / 16000
    # Trim sustained near-silence, never speech VAD on singing.
    frame = 320
    count = len(samples) // frame
    first, last = 0, len(samples)
    if count >= 5:
        rms = np.sqrt(np.mean(samples[:count*frame].reshape(count, frame).astype(np.float64)**2, axis=1))
        high, low = float(np.percentile(rms, 95)), float(np.percentile(rms, 10))
        if high >= 1e-5 and high >= low * 5:
            active = np.convolve((rms > max(1e-5, high*.025)).astype(int), np.ones(5, dtype=int), 'same') >= 4
            indices = np.flatnonzero(active)
            if len(indices):
                first = max(0, int(indices[0]*frame - 8000))
                last = min(len(samples), int((indices[-1]+1)*frame + 11200))
    offset = first / 16000
    device = 'cpu' if args.device == 'cpu' else 'cuda'
    fallback = None
    loaded_model = None
    def run(device):
        nonlocal loaded_model
        emit({"type": "progress", "phase": "aligning", "status": "Đang căn trực tiếp lời vào audio · " + device, "percent": 15})
        with contextlib.redirect_stdout(sys.stderr):
            model = stable_whisper.load_faster_whisper(args.model, device=device, compute_type='int8' if device == 'cpu' else 'float16')
            loaded_model = model
            return model.align(samples[first:last], unicodedata.normalize('NFC', lyrics).lower(), language=args.language if args.language not in ('', 'auto') else 'vi', original_split=True, vad=False, verbose=False).to_dict()
    try:
        result = run(device)
    except Exception as error:
        if args.device != 'auto' or device == 'cpu':
            raise
        fallback, device = str(error), 'cpu'
        result = run(device)
    segments = result.get('segments', [])
    if len(segments) != len(lines):
        raise RuntimeError('Model không căn đủ dòng lời. Hãy kiểm tra lời hoặc căn đoạn ngắn hơn.')
    output, all_words = [], []
    for index, (tokens, segment) in enumerate(zip(lines, segments)):
        spans = []
        for item in segment.get('words', []):
            parts = item.get('word', '').split()
            a, b = float(item['start']), float(item['end'])
            for k in range(len(parts)):
                spans.append((a+(b-a)*k/len(parts), a+(b-a)*(k+1)/len(parts)))
        if len(spans) != len(tokens):
            raise RuntimeError(f'Dòng {index+1}: số từ căn được không khớp lời. Kết quả cũ được giữ nguyên.')
        words = []
        for k, (token, (a, b)) in enumerate(zip(tokens, spans)):
            a, b = a+offset, b+offset
            if not math.isfinite(a) or not math.isfinite(b) or a < 0 or b < a or b > duration+.05:
                raise RuntimeError(f'Dòng {index+1}: timestamp không hợp lệ. Hãy căn đoạn ngắn hơn.')
            words.append({'id': f'aligned-{index+1}-{k+1}', 'text': token, 'start': a, 'end': min(duration, max(a+.03, b)), 'origin': 'estimated' if b-a < .05 else 'aligned'})
        all_words.extend(words)
        output.append({'id': f'segment-{index+1}', 'text': ' '.join(tokens), 'start': words[0]['start'], 'end': words[-1]['end'], 'words': words})
    try:
        with contextlib.redirect_stdout(sys.stderr):
            repair_prefix(loaded_model, samples[first:last], all_words, offset, args.language)
    except Exception as error:
        emit({'type': 'progress', 'phase': 'aligning', 'percent': 94, 'status': 'Giữ kết quả căn chính: ' + str(error)[:120]})
    for i, word in enumerate(all_words):
        if word.pop('estimated', False):
            word['origin'] = 'estimated'
        if i and word['start'] < all_words[i-1]['end']:
            all_words[i-1]['end'] = max(all_words[i-1]['start']+.001, word['start'])
            all_words[i-1]['origin'] = 'estimated'
        if word['end'] <= word['start']:
            raise RuntimeError('Không đủ thời gian để căn từ. Hãy chọn đoạn ngắn hơn.')
    for segment in output:
        segment['start'] = segment['words'][0]['start']
        segment['end'] = max(w['end'] for w in segment['words'])
    short = sum(w['end']-w['start'] < .05 for w in all_words)
    prefix = all_words[:40]
    if len(all_words) >= 12 and (short/len(all_words) > .35 or sum(w['end']-w['start'] < .05 for w in prefix)/len(prefix) > .6):
        raise RuntimeError('Căn lời chưa tin cậy: quá nhiều từ bị dồn mốc. Kết quả cũ được giữ nguyên.')
    emit({'type': 'result', 'segments': output, 'duration': duration, 'timingMethod': 'direct-lyrics-alignment', 'device': device, 'deviceFallbackReason': fallback})
    return 0


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--audio")
    parser.add_argument("--model", default="small")
    parser.add_argument("--language", default="vi")
    parser.add_argument("--device", choices=("auto", "cpu", "cuda"), default="auto")
    parser.add_argument("--prompt", default="")
    parser.add_argument("--lyrics-file", default="")
    parser.add_argument("--health-check", action="store_true")
    args = parser.parse_args()

    if args.health_check:
        def package_info(module_name, distribution_name, verify_import=False):
            try:
                available = importlib.util.find_spec(module_name) is not None
            except (ImportError, ValueError):
                available = False
            try:
                version = importlib.metadata.version(distribution_name) if available else None
            except importlib.metadata.PackageNotFoundError:
                version = "installed · version unknown" if available else None
            error = None
            if available and verify_import:
                try:
                    importlib.import_module("demucs.separate" if module_name == "demucs" else module_name)
                except Exception as exception:
                    available = False
                    error = str(exception)
            return {"available": available, "version": version, "error": error}

        cuda_device_count = 0
        try:
            import ctranslate2
            cuda_device_count = int(ctranslate2.get_cuda_device_count())
        except Exception:
            pass
        manifest_path = os.environ.get("KARA_RUNTIME_MANIFEST")
        try:
            python_supported = supported_python_version(sys.version_info, manifest_path)
        except Exception:
            python_supported = False
        faster_whisper = package_info("faster_whisper", "faster-whisper")
        pyav = package_info("av", "av")
        ctranslate2 = package_info("ctranslate2", "ctranslate2")
        demucs = package_info("demucs", "demucs", verify_import=True)
        emit({
            "type": "result",
            "healthCheck": True,
            "pythonVersion": sys.version.split()[0],
            "pythonExecutable": sys.executable,
            "pythonSupported": python_supported,
            "fasterWhisper": faster_whisper,
            "av": pyav,
            "ctranslate2": ctranslate2,
            "stableWhisper": package_info("stable_whisper", "stable-ts", verify_import=True),
            "demucs": demucs,
            "runtimeReady": python_supported and faster_whisper["available"] and pyav["available"] and ctranslate2["available"],
            "cudaDeviceCount": cuda_device_count,
        })
        return 0

    manifest_path = os.environ.get("KARA_RUNTIME_MANIFEST")
    try:
        if not supported_python_version(sys.version_info, manifest_path):
            emit({"type": "error", "code": "runtime-unsupported", "message": "Python runtime không nằm trong dải được hỗ trợ (3.10–3.12)."})
            return 2
    except Exception as error:
        emit({"type": "error", "code": "runtime-manifest-invalid", "message": f"Không đọc được runtime manifest: {error}"})
        return 2

    if not args.audio:
        emit({"type": "error", "code": "audio-required", "message": "Thiếu đường dẫn audio."})
        return 2

    try:
        prepare_cuda_libraries()
        prepare_faster_whisper_audio_compatibility()
        from faster_whisper import WhisperModel
    except ImportError as error:
        emit({"type": "error", "code": "runtime-missing", "message": f"Chưa cài Faster-Whisper trong {sys.executable}. Cài runtime local và faster-whisper rồi thử lại: {error}"})
        return 2

    try:
        if args.lyrics_file:
            return align_supplied_lyrics(args)
        device = args.device
        if device == "auto":
            device = "cuda"
        compute_type = "float16" if device == "cuda" else "int8"
        emit({"type": "progress", "phase": "loading-model", "status": "Đang nạp model nhận dạng…", "percent": 2})
        device_fallback_reason = None
        try:
            model = WhisperModel(args.model, device=device, compute_type=compute_type)
        except Exception as error:
            if device != "cpu":
                device_fallback_reason = str(error) or "Không khởi tạo được model trên GPU."
                device = "cpu"
                model = WhisperModel(args.model, device=device, compute_type="int8")
            else:
                raise
        emit({"type": "progress", "phase": "transcribing", "status": "Đang nhận dạng audio và lấy timestamp từng từ…", "percent": 10})
        def transcribe_loaded_model(active_model):
            segments, info = active_model.transcribe(
                args.audio,
                language=None if args.language in ("", "auto") else args.language,
                word_timestamps=True,
                vad_filter=False,
                condition_on_previous_text=False,
                initial_prompt=args.prompt.strip() or None,
            )
            duration = getattr(info, "duration", None)
            output = []
            for segment_index, segment in enumerate(segments):
                words = []
                for word_index, word in enumerate(segment.words or []):
                    text = (word.word or "").strip()
                    if not text:
                        continue
                    start = max(0.0, float(word.start))
                    end = max(start + 0.01, float(word.end))
                    words.append({
                        "id": f"word-{segment_index + 1}-{word_index + 1}",
                        "text": text,
                        "start": start,
                        "end": end,
                        "confidence": max(0.0, min(1.0, float(word.probability))),
                        "origin": "asr",
                    })
                text = (segment.text or "").strip()
                if text:
                    segment_start = max(0.0, float(segment.start))
                    segment_end = max(segment_start + 0.1, float(segment.end))
                    segment_start, segment_end = enclose_segment_words(segment_start, segment_end, words)
                    output.append({
                        "id": f"segment-{segment_index + 1}",
                        "text": text,
                        "start": segment_start,
                        "end": segment_end,
                        "confidence": None,
                        "words": words,
                    })
                if duration and duration > 0 and segment_index % 4 == 0:
                    percent = min(95, max(10, int(float(segment.end) / duration * 85) + 10))
                    emit({"type": "progress", "phase": "transcribing", "status": "Đang xử lý timestamp…", "percent": percent})
            return output, info

        try:
            output, info = transcribe_loaded_model(model)
        except Exception as error:
            # Faster-Whisper yields segments lazily, so CUDA library failures can
            # happen after model construction. Retry the full pass on CPU.
            if device != "cuda":
                raise
            device_fallback_reason = str(error) or "Không chạy được nhận dạng trên GPU."
            device = "cpu"
            model = WhisperModel(args.model, device=device, compute_type="int8")
            emit({"type": "progress", "phase": "transcribing", "status": "GPU không sẵn sàng; đang tiếp tục trên CPU…", "percent": 10})
            output, info = transcribe_loaded_model(model)
        duration = getattr(info, "duration", None)
        emit({"type": "result", "duration": duration, "segments": output, "source": "audio", "timingMethod": "asr", "device": device, "deviceFallbackReason": device_fallback_reason})
        return 0
    except Exception as error:
        emit({"type": "error", "code": "transcription-failed", "message": str(error) or "Faster-Whisper không tạo được timestamp."})
        return 1


if __name__ == "__main__":
    sys.exit(main())
