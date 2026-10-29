import argparse
import contextlib
import json
import os
import subprocess
import sys
from pathlib import Path


def emit(payload):
    sys.stdout.write(json.dumps(payload, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--model-dir", required=True)
    parser.add_argument("--reference-wav", required=True)
    parser.add_argument("--cuda", action="store_true")
    args = parser.parse_args()

    model_dir = Path(args.model_dir).resolve()
    reference_wav = Path(args.reference_wav).resolve()

    try:
        from TTS.api import TTS

        with contextlib.redirect_stdout(sys.stderr):
            tts = TTS(
                model_path=str(model_dir),
                config_path=str(model_dir / "config.json"),
                progress_bar=False,
                gpu=False,
            )
            tts.to("cuda" if args.cuda else "cpu")
            model = tts.synthesizer.tts_model
            gpt_cond_latent, speaker_embedding = model.get_conditioning_latents(
                audio_path=str(reference_wav),
                max_ref_length=12,
                gpt_cond_len=6,
                gpt_cond_chunk_len=6,
            )
            model.speaker_manager.speakers["yuki-reference"] = {
                "gpt_conditioning_latents": gpt_cond_latent,
                "speaker_embedding": speaker_embedding,
            }
        emit({"type": "ready"})
    except Exception as error:
        emit({"type": "fatal", "error": str(error)})
        return 1

    for raw_line in sys.stdin:
        if not raw_line.strip():
            continue
        request = None
        try:
            request = json.loads(raw_line)
            output_path = Path(request["output"]).resolve()
            language = request.get("language", "tr")
            speaker_wav = request.get("speaker_wav") or str(reference_wav)
            text = str(request.get("text", "")).strip()
            if not text:
                raise ValueError("text boş olamaz")
            with contextlib.redirect_stdout(sys.stderr):
                tts.tts_to_file(
                    text=text,
                    speaker="yuki-reference",
                    language=language,
                    temperature=float(os.environ.get("XTTS_TEMPERATURE", "0.80")),
                    speed=float(os.environ.get("XTTS_SPEED", "1.15")),
                    repetition_penalty=float(os.environ.get("XTTS_REPETITION_PENALTY", "7.0")),
                    enable_text_splitting=True,
                    file_path=str(output_path),
                )
            final_output = output_path
            gain = float(os.environ.get("XTTS_OUTPUT_GAIN", "2.0"))
            if gain != 1.0:
                boosted_path = output_path.with_name(f"{output_path.stem}-boosted.wav")
                subprocess.run(
                    [
                        "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
                        "-i", str(output_path),
                        "-af", f"highpass=f=80,lowpass=f=12000,afftdn=nr=6:nf=-35:tn=1,volume={gain},alimiter=limit=0.98",
                        str(boosted_path),
                    ],
                    check=True,
                )
                final_output = boosted_path
            emit({"id": request.get("id"), "ok": True, "output": str(final_output)})
        except Exception as error:
            emit({
                "id": request.get("id") if isinstance(request, dict) else None,
                "ok": False,
                "error": str(error),
            })

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
