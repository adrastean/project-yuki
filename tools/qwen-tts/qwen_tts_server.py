import argparse
import contextlib
import json
import sys
from pathlib import Path


def emit(payload):
    sys.stdout.write(json.dumps(payload, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--model-id", required=True)
    parser.add_argument("--reference-wav", required=True)
    parser.add_argument("--reference-text", required=True)
    args = parser.parse_args()

    reference_wav = Path(args.reference_wav).resolve()
    if not reference_wav.is_file():
        emit({"type": "fatal", "error": f"Qwen reference audio not found: {reference_wav}"})
        return 1

    try:
        import soundfile as sf
        import torch
        from qwen_tts import Qwen3TTSModel

        use_cuda = torch.cuda.is_available()
        device = "cuda:0" if use_cuda else "cpu"
        dtype = torch.bfloat16 if use_cuda and torch.cuda.is_bf16_supported() else torch.float16 if use_cuda else torch.float32
        with contextlib.redirect_stdout(sys.stderr):
            model = Qwen3TTSModel.from_pretrained(
                args.model_id,
                device_map=device,
                dtype=dtype,
                attn_implementation="sdpa",
            )
            voice_prompt = model.create_voice_clone_prompt(
                ref_audio=str(reference_wav),
                ref_text=args.reference_text,
                x_vector_only_mode=False,
            )
        emit({"type": "ready", "device": device, "model": args.model_id})
    except Exception as error:
        emit({"type": "fatal", "error": str(error)})
        return 1

    for raw_line in sys.stdin:
        if not raw_line.strip():
            continue
        request = None
        try:
            request = json.loads(raw_line)
            text = str(request.get("text", "")).strip()
            output_path = Path(request["output"]).resolve()
            if not text:
                raise ValueError("Text to synthesize is empty")
            with contextlib.redirect_stdout(sys.stderr):
                wavs, sample_rate = model.generate_voice_clone(
                    text=text,
                    language="English",
                    voice_clone_prompt=voice_prompt,
                )
            output_path.parent.mkdir(parents=True, exist_ok=True)
            sf.write(str(output_path), wavs[0], sample_rate)
            emit({"id": request.get("id"), "ok": True, "output": str(output_path)})
        except Exception as error:
            emit({
                "id": request.get("id") if isinstance(request, dict) else None,
                "ok": False,
                "error": str(error),
            })

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
