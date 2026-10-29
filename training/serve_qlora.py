"""Small local stdin/stdout runner for Yuki's Qwen2.5 QLoRA adapter."""

import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
PROJECT_ROOT = ROOT.parent
os.environ.setdefault("HF_HOME", str(PROJECT_ROOT / ".hf-cache"))

import torch
from peft import PeftModel
from transformers import AutoModelForCausalLM, AutoTokenizer, BitsAndBytesConfig

MODEL_DIR = ROOT / "models" / "Qwen2.5-3B-Instruct"
ADAPTER_DIR = ROOT / "output" / "yuki-tr-qlora" / "adapter"


def emit(event: dict) -> None:
    print(json.dumps(event, ensure_ascii=False), flush=True)


def load_model():
    if not torch.cuda.is_available():
        raise RuntimeError("CUDA destekli NVIDIA GPU bulunamadı. QLoRA test modu RTX GPU gerektiriyor.")
    if not (MODEL_DIR / "config.json").is_file():
        raise RuntimeError(f"Temel model bulunamadı: {MODEL_DIR}")
    if not (ADAPTER_DIR / "adapter_model.safetensors").is_file():
        raise RuntimeError(f"LoRA adaptörü bulunamadı: {ADAPTER_DIR}")

    dtype = torch.bfloat16 if torch.cuda.is_bf16_supported() else torch.float16
    quantization = BitsAndBytesConfig(
        load_in_4bit=True,
        bnb_4bit_quant_type="nf4",
        bnb_4bit_use_double_quant=True,
        bnb_4bit_compute_dtype=dtype,
    )
    tokenizer = AutoTokenizer.from_pretrained(MODEL_DIR, use_fast=True, local_files_only=True)
    base = AutoModelForCausalLM.from_pretrained(
        MODEL_DIR,
        quantization_config=quantization,
        torch_dtype=dtype,
        device_map={"": 0},
        low_cpu_mem_usage=True,
        local_files_only=True,
    )
    model = PeftModel.from_pretrained(base, ADAPTER_DIR, local_files_only=True)
    model.eval()
    return tokenizer, model


def run_turn(tokenizer, model, request: dict) -> str:
    messages = request.get("messages")
    if not isinstance(messages, list) or not messages:
        raise ValueError("İstek mesaj listesi içermiyor.")
    prompt = tokenizer.apply_chat_template(
        messages,
        tokenize=True,
        add_generation_prompt=True,
        return_tensors="pt",
    ).to(model.device)
    language = request.get("language", "en")
    with torch.inference_mode():
        output = model.generate(
            input_ids=prompt,
            attention_mask=torch.ones_like(prompt),
            max_new_tokens=220,
            do_sample=True,
            temperature=0.55 if language == "tr" else 0.68,
            top_p=0.88,
            repetition_penalty=1.08,
            pad_token_id=tokenizer.eos_token_id,
            eos_token_id=tokenizer.eos_token_id,
        )
    return tokenizer.decode(output[0, prompt.shape[-1]:], skip_special_tokens=True).strip()


def main() -> None:
    try:
        tokenizer, model = load_model()
        emit({"ready": True})
    except Exception as error:
        emit({"fatal": f"QLoRA model could not start: {type(error).__name__}: {error}"})
        return

    for line in sys.stdin:
        try:
            request = json.loads(line)
            reply = run_turn(tokenizer, model, request)
            emit({"id": request.get("id"), "reply": reply})
        except Exception as error:
            emit({"id": request.get("id") if "request" in locals() else None,
                  "error": f"{type(error).__name__}: {error}"})


if __name__ == "__main__":
    main()
