import argparse
import json
import os
import queue
import sys
import time
from pathlib import Path

import numpy as np
import sounddevice as sd


_cuda_dll_handles = []


def add_cuda_dll_paths():
    if os.name != "nt":
        return
    site_packages = Path(sys.prefix) / "Lib" / "site-packages"
    for relative in (
        Path("nvidia") / "cublas" / "bin",
        Path("nvidia") / "cudnn" / "bin",
        Path("nvidia") / "cuda_nvrtc" / "bin",
    ):
        directory = site_packages / relative
        if not directory.is_dir():
            continue
        os.environ["PATH"] = f"{directory};{os.environ.get('PATH', '')}"
        try:
            _cuda_dll_handles.append(os.add_dll_directory(str(directory)))
        except (AttributeError, OSError):
            pass


add_cuda_dll_paths()

from faster_whisper import WhisperModel


def emit(text):
    print(json.dumps({"text": text.strip()}, ensure_ascii=False), flush=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", default="small.en")
    parser.add_argument("--cache-dir", required=True)
    parser.add_argument("--device", default="cuda")
    parser.add_argument("--compute-type", default="float16")
    parser.add_argument("--timeout-ms", type=int, default=30000)
    parser.add_argument("--silence-ms", type=int, default=1800)
    parser.add_argument("--energy-threshold", type=float, default=80)
    args = parser.parse_args()

    audio_queue = queue.Queue()

    def callback(indata, frames, time_info, status):
        if status:
            print(str(status), file=sys.stderr, flush=True)
        audio_queue.put(bytes(indata))

    deadline = time.monotonic() + args.timeout_ms / 1000
    started_speaking = False
    last_voice = None
    frames = []

    with sd.RawInputStream(
        samplerate=16000,
        blocksize=4000,
        dtype="int16",
        channels=1,
        callback=callback,
    ):
        # Capture immediately so the first words are buffered while Whisper loads.
        try:
            model = WhisperModel(
                args.model,
                device=args.device,
                compute_type=args.compute_type,
                download_root=args.cache_dir,
            )
        except Exception as error:
            if args.device != "cuda":
                raise
            print(f"CUDA Whisper unavailable, using CPU: {error}", file=sys.stderr, flush=True)
            model = WhisperModel(
                args.model,
                device="cpu",
                compute_type="int8",
                download_root=args.cache_dir,
            )

        while time.monotonic() < deadline:
            try:
                chunk = audio_queue.get(timeout=0.25)
            except queue.Empty:
                continue
            frames.append(chunk)
            samples = np.frombuffer(chunk, dtype=np.int16).astype(np.float32)
            energy = float(np.sqrt(np.mean(samples * samples))) if samples.size else 0
            if energy >= args.energy_threshold:
                started_speaking = True
                last_voice = time.monotonic()
            elif started_speaking and last_voice and time.monotonic() - last_voice >= args.silence_ms / 1000:
                break

    if not started_speaking or not frames:
        emit("")
        return

    audio = np.frombuffer(b"".join(frames), dtype=np.int16).astype(np.float32) / 32768.0
    segments, _info = model.transcribe(
        audio,
        language="en",
        initial_prompt="A casual conversation in clear English between the user and Yuki.",
        beam_size=5,
        best_of=5,
        temperature=0,
        condition_on_previous_text=False,
        vad_filter=True,
        vad_parameters={"min_silence_duration_ms": 500},
    )
    emit(" ".join(segment.text.strip() for segment in segments if segment.text.strip()))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(str(error), file=sys.stderr, flush=True)
        sys.exit(1)
