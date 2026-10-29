import argparse
import json
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent
os.environ.setdefault("HF_HOME", str(ROOT.parent / ".hf-cache"))

import torch
from datasets import load_dataset
from peft import LoraConfig
from transformers import AutoModelForCausalLM, AutoTokenizer, BitsAndBytesConfig
from trl import SFTConfig, SFTTrainer


MODEL_DIR = ROOT / "models" / "Qwen2.5-3B-Instruct"
MODEL_INDEX = MODEL_DIR / "model.safetensors.index.json"
if MODEL_INDEX.exists():
    try:
        shard_names = set(json.loads(MODEL_INDEX.read_text(encoding="utf-8"))["weight_map"].values())
        LOCAL_MODEL_READY = bool(shard_names) and all((MODEL_DIR / name).is_file() for name in shard_names)
    except (OSError, KeyError, json.JSONDecodeError):
        LOCAL_MODEL_READY = False
else:
    LOCAL_MODEL_READY = False
DEFAULT_MODEL = str(MODEL_DIR if LOCAL_MODEL_READY else "Qwen/Qwen2.5-3B-Instruct")


def validate_jsonl(path: Path) -> int:
    count = 0
    with path.open("r", encoding="utf-8") as source:
        for line_number, line in enumerate(source, start=1):
            if not line.strip():
                continue
            item = json.loads(line)
            if not isinstance(item.get("prompt"), list) or not isinstance(item.get("completion"), list):
                raise ValueError(f"{path.name}:{line_number}: prompt/completion listesi eksik")
            if not item["prompt"] or not item["completion"]:
                raise ValueError(f"{path.name}:{line_number}: prompt veya completion boş")
            if item["completion"][-1].get("role") != "assistant":
                raise ValueError(f"{path.name}:{line_number}: completion son mesajı assistant olmalı")
            count += 1
    return count


def main() -> None:
    parser = argparse.ArgumentParser(description="Yuki için yerel QLoRA Türkçe sohbet adaptörü eğitimi")
    parser.add_argument("--model", default=os.environ.get("YUKI_TRAIN_MODEL", DEFAULT_MODEL))
    parser.add_argument("--epochs", type=float, default=3)
    parser.add_argument("--max-length", type=int, default=512)
    parser.add_argument("--output", type=Path, default=ROOT / "output" / "yuki-tr-qlora")
    args = parser.parse_args()

    train_file = ROOT / "turkish_train.jsonl"
    eval_file = ROOT / "turkish_eval.jsonl"
    print(f"Eğitim örneği: {validate_jsonl(train_file)}")
    print(f"Doğrulama örneği: {validate_jsonl(eval_file)}")
    if not torch.cuda.is_available():
        raise SystemExit("CUDA destekli NVIDIA GPU bulunamadı; eğitim başlamadı.")

    dtype = torch.bfloat16 if torch.cuda.is_bf16_supported() else torch.float16
    quantization = BitsAndBytesConfig(
        load_in_4bit=True,
        bnb_4bit_quant_type="nf4",
        bnb_4bit_use_double_quant=True,
        bnb_4bit_compute_dtype=dtype,
    )
    tokenizer = AutoTokenizer.from_pretrained(args.model, use_fast=True)
    if tokenizer.pad_token is None:
        tokenizer.pad_token = tokenizer.eos_token
    model = AutoModelForCausalLM.from_pretrained(
        args.model,
        quantization_config=quantization,
        torch_dtype=dtype,
        device_map={"": 0},
        low_cpu_mem_usage=True,
    )
    model.config.use_cache = False

    datasets = load_dataset("json", data_files={"train": str(train_file), "eval": str(eval_file)})
    lora = LoraConfig(
        r=8,
        lora_alpha=16,
        lora_dropout=0.05,
        bias="none",
        task_type="CAUSAL_LM",
        target_modules="all-linear",
    )
    training = SFTConfig(
        output_dir=str(args.output),
        num_train_epochs=args.epochs,
        per_device_train_batch_size=1,
        per_device_eval_batch_size=1,
        gradient_accumulation_steps=8,
        learning_rate=1e-4,
        warmup_steps=1,
        lr_scheduler_type="cosine",
        optim="paged_adamw_8bit",
        max_length=args.max_length,
        completion_only_loss=True,
        eval_strategy="epoch",
        save_strategy="epoch",
        logging_steps=2,
        gradient_checkpointing=True,
        gradient_checkpointing_kwargs={"use_reentrant": False},
        bf16=dtype == torch.bfloat16,
        fp16=dtype == torch.float16,
        report_to="none",
        seed=42,
        data_seed=42,
        save_total_limit=2,
        load_best_model_at_end=True,
        metric_for_best_model="eval_loss",
        greater_is_better=False,
    )
    trainer = SFTTrainer(
        model=model,
        args=training,
        train_dataset=datasets["train"],
        eval_dataset=datasets["eval"],
        processing_class=tokenizer,
        peft_config=lora,
    )
    trainer.train()
    trainer.save_model(str(args.output / "adapter"))
    tokenizer.save_pretrained(str(args.output / "adapter"))
    print(f"Adapter kaydedildi: {args.output / 'adapter'}")
    print("Not: Bu klasör tek başına model değildir; temel modelle birlikte kullanılmalıdır.")


if __name__ == "__main__":
    main()
