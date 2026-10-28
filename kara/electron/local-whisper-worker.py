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


def aligned_words_are_usable(original, words, expected_word_count):
    """Reject collapsed/low-evidence alignment instead of replacing usable ASR timing."""
    if not words or len(words) < max(1, math.ceil(expected_word_count * 0.75)):
        return False
    scores = [word.get("score") for word in words]
    if any(not isinstance(score, (int, float)) or not math.isfinite(score) for score in scores):
        return False
    if sum(scores) / len(scores) < 0.08:
        return False
    for word in words:
        start, end = word.get("start"), word.get("end")
        if not isinstance(start, (int, float)) or not isinstance(end, (int, float)):
            return False
        if not math.isfinite(start) or not math.isfinite(end) or start < 0 or end <= start:
            return False
        if start < original["start"] - 0.5 or end > original["end"] + 0.5:
            return False
    return True


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--audio")
    parser.add_argument("--model", default="small")
    parser.add_argument("--language", default="vi")
    parser.add_argument("--device", choices=("auto", "cpu", "cuda"), default="auto")
    parser.add_argument("--prompt", default="")
    parser.add_argument("--forced-align", action="store_true")
    parser.add_argument("--align-model", default="")
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
        whisperx = package_info("whisperx", "whisperx")
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
            "whisperx": whisperx,
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
        prepare_faster_whisper_audio_compatibility()
        from faster_whisper import WhisperModel
    except ImportError as error:
        emit({"type": "error", "code": "runtime-missing", "message": f"Chưa cài Faster-Whisper trong {sys.executable}. Cài runtime local và faster-whisper rồi thử lại: {error}"})
        return 2

    try:
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
        timing_method = "asr"
        if args.forced_align:
            try:
                import whisperx
            except ImportError as error:
                emit({"type": "error", "code": "alignment-runtime-missing", "message": "Chưa cài WhisperX. Chạy `python -m pip install whisperx` trong Python runtime của Kara Studio rồi thử lại."})
                return 2
            if not output:
                emit({"type": "error", "code": "alignment-empty-transcript", "message": "ASR không tạo được nội dung để căn tinh."})
                return 1
            language = args.language if args.language not in ("", "auto") else getattr(info, "language", "")
            if not language:
                emit({"type": "error", "code": "alignment-language-unknown", "message": "WhisperX cần biết ngôn ngữ để chọn model căn tinh."})
                return 1
            emit({"type": "progress", "phase": "loading-aligner", "status": f"Đang nạp model căn tinh WhisperX ({language})…", "percent": 96})
            model_options = {"language_code": language, "device": device}
            if args.align_model.strip():
                model_options["model_name"] = args.align_model.strip()
            import gc
            del model
            gc.collect()
            if device == "cuda":
                try:
                    import torch
                    torch.cuda.empty_cache()
                except Exception:
                    pass
            try:
                align_model, metadata = whisperx.load_align_model(**model_options)
            except Exception as error:
                if device != "cuda":
                    raise
                device_fallback_reason = (device_fallback_reason + " · " if device_fallback_reason else "") + f"WhisperX chuyển sang CPU: {error}"
                device = "cpu"
                model_options["device"] = device
                align_model, metadata = whisperx.load_align_model(**model_options)
            emit({"type": "progress", "phase": "forced-alignment", "status": "Đang căn chi tiết timestamp trên audio…", "percent": 98})
            audio = whisperx.load_audio(args.audio)
            source_segments = [{"start": segment["start"], "end": segment["end"], "text": segment["text"]} for segment in output]
            aligned_result = whisperx.align(source_segments, align_model, metadata, audio, device, return_char_alignments=False)
            aligned_segments = aligned_result.get("segments", [])
            refined = []
            for index, original in enumerate(output):
                aligned_segment = aligned_segments[index] if index < len(aligned_segments) else {}
                aligned_words = []
                for word_index, word in enumerate(aligned_segment.get("words", [])):
                    start = word.get("start")
                    end = word.get("end")
                    text = str(word.get("word", "")).strip()
                    if not text or not isinstance(start, (int, float)) or not isinstance(end, (int, float)) or not math.isfinite(start) or not math.isfinite(end) or end <= start:
                        continue
                    aligned_words.append({
                        "id": f"aligned-{index + 1}-{word_index + 1}",
                        "text": text,
                        "start": max(0.0, float(start)),
                        "end": max(float(start) + 0.01, float(end)),
                        "confidence": max(0.0, min(1.0, float(word.get("score", 0.8)))),
                        "origin": "aligned",
                    })
                expected_words = len(original.get("words", []))
                enough_words = aligned_words_are_usable(original, aligned_words, expected_words)
                refined.append({
                    **original,
                    "start": aligned_words[0]["start"] if enough_words else original["start"],
                    "end": aligned_words[-1]["end"] if enough_words else original["end"],
                    "words": aligned_words if enough_words else original.get("words", []),
                })
            output = refined
            timing_method = "forced-alignment"
        emit({"type": "result", "duration": duration, "segments": output, "source": "audio", "timingMethod": timing_method, "device": device, "deviceFallbackReason": device_fallback_reason})
        return 0
    except Exception as error:
        emit({"type": "error", "code": "transcription-failed", "message": str(error) or "Faster-Whisper không tạo được timestamp."})
        return 1


if __name__ == "__main__":
    sys.exit(main())
