# -*- coding: utf-8 -*-
"""Standalone video audio extraction and ASR transcription using PyAV + SenseVoice."""

import argparse
import json
import os
import sys
import tempfile
from pathlib import Path


def extract_audio_to_wav(video_path: str, output_wav: str) -> float:
    """Extract audio from video container and resample to 16kHz mono WAV using PyAV."""
    import av

    container = av.open(video_path)
    audio_stream = next((s for s in container.streams if s.type == "audio"), None)
    if not audio_stream:
        raise ValueError(f"No audio stream found in {video_path}")

    duration = float(audio_stream.duration * audio_stream.time_base) if audio_stream.duration else 0.0

    resampler = av.AudioResampler(
        format="s16",
        layout="mono",
        rate=16000,
    )

    output_container = av.open(output_wav, mode="w")
    out_stream = output_container.add_stream("pcm_s16le", rate=16000)
    out_stream.layout = "mono"

    for packet in container.demux(audio_stream):
        for frame in packet.decode():
            for resampled_frame in resampler.resample(frame):
                for out_packet in out_stream.encode(resampled_frame):
                    output_container.mux(out_packet)

    for out_packet in out_stream.encode(None):
        output_container.mux(out_packet)

    output_container.close()
    container.close()
    return duration


def transcribe_audio(wav_path: str, model_path: str) -> list[dict]:
    """Run SenseVoice transcription on standard 16kHz WAV."""
    import torch
    from funasr import AutoModel
    from funasr.utils.postprocess_utils import rich_transcription_postprocess

    device = "cuda:0" if torch.cuda.is_available() else "cpu"
    model = AutoModel(
        model=model_path,
        vad_model="fsmn-vad",
        vad_kwargs={"max_single_segment_time": 30000},
        device=device,
        disable_update=True,
    )

    results = model.generate(
        input=wav_path,
        cache={},
        language="auto",
        use_itn=True,
        batch_size_s=60,
        merge_vad=True,
        merge_length_s=15,
    )

    segments = []
    for result in results:
        sentence_info = result.get("sentence_info") or []
        if sentence_info:
            for seg in sentence_info:
                text = rich_transcription_postprocess(seg.get("text", seg.get("sentence", ""))).strip()
                if text:
                    start_s = float(seg.get("start", 0)) / 1000.0
                    end_s = float(seg.get("end", 0)) / 1000.0
                    segments.append({"start": round(start_s, 2), "end": round(end_s, 2), "text": text})
        else:
            raw_text = rich_transcription_postprocess(result.get("text", "")).strip()
            if raw_text:
                segments.append({"start": 0.0, "end": 0.0, "text": raw_text})

    return segments


def format_transcript_markdown(title: str, duration: float, segments: list[dict]) -> str:
    lines = [f"# {title}", "", f"> 视频时长：{duration:.1f} 秒 | 分段数：{len(segments)}", ""]
    for seg in segments:
        start_min = int(seg["start"] // 60)
        start_sec = seg["start"] % 60
        time_tag = f"[{start_min:02d}:{start_sec:04.1f}]"
        lines.append(f"{time_tag} {seg['text']}")
    return "\n".join(lines) + "\n"


def main():
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    if hasattr(sys.stderr, "reconfigure"):
        sys.stderr.reconfigure(encoding="utf-8")

    parser = argparse.ArgumentParser(description="Extract and transcribe video")
    parser.add_argument("--config", help="UTF-8 JSON config file path")
    parser.add_argument("--video", help="Input video or audio path")
    parser.add_argument("--model", help="SenseVoice model path")
    parser.add_argument("--title", default="视频转写结果", help="Video title")
    args = parser.parse_args()

    if args.config and os.path.exists(args.config):
        with open(args.config, "r", encoding="utf-8-sig") as f:
            cfg = json.load(f)
        video_raw = cfg.get("video")
        model_raw = cfg.get("model")
        title = cfg.get("title", "视频转写结果")
    else:
        video_raw = args.video
        model_raw = args.model
        title = args.title

    if not video_raw or not model_raw:
        print(json.dumps({"ok": False, "error": "Missing video or model parameter"}, ensure_ascii=False))
        sys.exit(1)

    video_path = os.path.abspath(video_raw)
    model_path = os.path.abspath(model_raw)

    if not os.path.exists(video_path):
        print(json.dumps({"ok": False, "error": f"Video not found: {video_path}"}, ensure_ascii=False))
        sys.exit(1)

    temp_wav = None
    try:
        if video_path.lower().endswith(".wav"):
            wav_path = str(video_path)
            duration = 0.0
        else:
            with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
                temp_wav = f.name
            duration = extract_audio_to_wav(str(video_path), temp_wav)
            wav_path = temp_wav

        segments = transcribe_audio(wav_path, str(model_path))
        md = format_transcript_markdown(title, duration, segments)

        output = {
            "ok": True,
            "title": title,
            "duration": duration,
            "segments": segments,
            "transcriptMarkdown": md,
        }
        # Print pure JSON on the last line
        print(json.dumps(output, ensure_ascii=False))
    except Exception as e:
        print(json.dumps({"ok": False, "error": str(e)}, ensure_ascii=False))
        sys.exit(1)
    finally:
        if temp_wav and os.path.exists(temp_wav):
            try:
                os.remove(temp_wav)
            except OSError:
                pass


if __name__ == "__main__":
    main()
