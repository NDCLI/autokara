#!/usr/bin/env python3
"""Local word timestamp worker for Kara Studio.

The worker communicates only through JSON lines. It never reads project files or
separation models; audio and an optional Faster-Whisper model path are passed by
the Electron main process.
"""
import argparse
import json
import sys


def emit(value):
    sys.stdout.write(json.dumps(value, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--audio", required=True)
    parser.add_argument("--model", default="small")
    parser.add_argument("--language", default="vi")
    parser.add_argument("--device", choices=("auto", "cpu", "cuda"), default="auto")
    args = parser.parse_args()

    try:
        from faster_whisper import WhisperModel
    except ImportError as error:
        emit({"type": "error", "code": "runtime-missing", "message": "Chưa cài Faster-Whisper. Cài runtime local và faster-whisper rồi thử lại."})
        return 2

    try:
        device = args.device
        if device == "auto":
            device = "cuda"
        compute_type = "float16" if device == "cuda" else "int8"
        try:
            model = WhisperModel(args.model, device=device, compute_type=compute_type)
        except Exception:
            if device != "cpu":
                device = "cpu"
                model = WhisperModel(args.model, device=device, compute_type="int8")
            else:
                raise
        emit({"type": "progress", "status": "Đang nhận dạng audio và lấy timestamp từng từ…", "percent": 10})
        segments, info = model.transcribe(
            args.audio,
            language=None if args.language in ("", "auto") else args.language,
            word_timestamps=True,
            vad_filter=False,
            condition_on_previous_text=False,
        )
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
                })
            text = (segment.text or "").strip()
            if text:
                output.append({
                    "id": f"segment-{segment_index + 1}",
                    "text": text,
                    "start": max(0.0, float(segment.start)),
                    "end": max(float(segment.start) + 0.1, float(segment.end)),
                    "confidence": None,
                    "words": words,
                })
            if segment_index % 4 == 0:
                emit({"type": "progress", "status": "Đang xử lý timestamp…", "percent": 10})
        duration = getattr(info, "duration", None)
        emit({"type": "result", "duration": duration, "segments": output})
        return 0
    except Exception as error:
        emit({"type": "error", "code": "transcription-failed", "message": str(error) or "Faster-Whisper không tạo được timestamp."})
        return 1


if __name__ == "__main__":
    sys.exit(main())
