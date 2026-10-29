import argparse
import json
import queue
import sys
import time

import sounddevice as sd
from vosk import KaldiRecognizer, Model, SetLogLevel


def emit(text):
    print(json.dumps({"text": text.strip()}, ensure_ascii=False), flush=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", required=True)
    parser.add_argument("--timeout-ms", type=int, default=15000)
    parser.add_argument("--silence-ms", type=int, default=1100)
    args = parser.parse_args()

    SetLogLevel(-1)
    audio_queue = queue.Queue()

    def callback(indata, frames, time_info, status):
        if status:
            print(str(status), file=sys.stderr, flush=True)
        audio_queue.put(bytes(indata))

    deadline = time.monotonic() + args.timeout_ms / 1000
    last_partial = None
    last_speech = None
    final_parts = []

    with sd.RawInputStream(
        samplerate=16000,
        blocksize=4000,
        dtype="int16",
        channels=1,
        callback=callback,
    ):
        # Start capturing before loading the model so the first words are not
        # lost while Vosk initializes.
        model = Model(args.model)
        recognizer = KaldiRecognizer(model, 16000)
        while time.monotonic() < deadline:
            try:
                audio = audio_queue.get(timeout=0.25)
            except queue.Empty:
                continue

            if recognizer.AcceptWaveform(audio):
                result = json.loads(recognizer.Result()).get("text", "").strip()
                if result:
                    final_parts.append(result)
                    last_speech = time.monotonic()
            else:
                partial = json.loads(recognizer.PartialResult()).get("partial", "").strip()
                if partial and partial != last_partial:
                    last_partial = partial
                    last_speech = time.monotonic()
                if last_speech and time.monotonic() - last_speech >= args.silence_ms / 1000:
                    result = json.loads(recognizer.FinalResult()).get("text", "").strip()
                    parts = final_parts + ([result] if result else [])
                    if parts:
                        emit(" ".join(parts))
                        return

    result = json.loads(recognizer.FinalResult()).get("text", "").strip()
    parts = final_parts + ([result] if result else [])
    emit(" ".join(parts))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(str(error), file=sys.stderr, flush=True)
        sys.exit(1)
