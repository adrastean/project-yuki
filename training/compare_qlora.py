import json
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent
os.environ.setdefault("HF_HOME", str(ROOT.parent / ".hf-cache"))

import torch
from peft import PeftModel
from transformers import AutoModelForCausalLM, AutoTokenizer, BitsAndBytesConfig


MODEL_DIR = ROOT / "models" / "Qwen2.5-3B-Instruct"
ADAPTER_DIR = ROOT / "output" / "yuki-tr-qlora" / "adapter"


def main() -> None:
    if not torch.cuda.is_available():
        raise SystemExit("CUDA destekli NVIDIA GPU bulunamadı.")
    dtype = torch.bfloat16 if torch.cuda.is_bf16_supported() else torch.float16
    quantization = BitsAndBytesConfig(
        load_in_4bit=True,
        bnb_4bit_quant_type="nf4",
        bnb_4bit_use_double_quant=True,
        bnb_4bit_compute_dtype=dtype,
    )
    tokenizer = AutoTokenizer.from_pretrained(MODEL_DIR, use_fast=True)
    model = AutoModelForCausalLM.from_pretrained(
        MODEL_DIR,
        quantization_config=quantization,
        torch_dtype=dtype,
        device_map={"": 0},
        low_cpu_mem_usage=True,
    )
    model.eval()

    samples = [json.loads(line) for line in (ROOT / "turkish_eval.jsonl").read_text(encoding="utf-8").splitlines() if line.strip()]
    encoded_prompts = [
        tokenizer.apply_chat_template(sample["prompt"], tokenize=True, add_generation_prompt=True, return_tensors="pt").to(model.device)
        for sample in samples
    ]

    def generate(current_model, prompt):
        with torch.inference_mode():
            output = current_model.generate(
                **prompt,
                max_new_tokens=96,
                do_sample=False,
                pad_token_id=tokenizer.eos_token_id,
            )
        return tokenizer.decode(output[0, prompt["input_ids"].shape[-1]:], skip_special_tokens=True).strip()

    base_answers = [generate(model, prompt) for prompt in encoded_prompts]
    tuned_model = PeftModel.from_pretrained(model, ADAPTER_DIR)
    tuned_model.eval()
    tuned_answers = [generate(tuned_model, prompt) for prompt in encoded_prompts]

    for index, (sample, base, tuned) in enumerate(zip(samples, base_answers, tuned_answers), start=1):
        user_text = sample["prompt"][-1]["content"]
        print(f"\n[{index}] Kullanıcı: {user_text}\nTemel: {base}\nQLoRA: {tuned}")


if __name__ == "__main__":
    main()
