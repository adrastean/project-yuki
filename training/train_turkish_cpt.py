"""A guarded local QLoRA continued-pretraining pilot on clean Turkish prose."""

import argparse
import json
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent
CORPUS = ROOT / "corpus" / "processed"
MODEL_DIR = ROOT / "models" / "Qwen2.5-3B-Instruct"
os.environ.setdefault("HF_HOME", str(ROOT.parent / ".hf-cache"))

import torch
from datasets import load_dataset
from peft import LoraConfig
from transformers import AutoModelForCausalLM, AutoTokenizer, BitsAndBytesConfig
from trl import SFTConfig, SFTTrainer


def count_tokens(path: Path, tokenizer) -> int:
    count = 0
    with path.open("r", encoding="utf-8") as source:
        for line_number, line in enumerate(source, start=1):
            if not line.strip():
                continue
            try:
                row = json.loads(line)
            except json.JSONDecodeError as error:
                raise SystemExit(f"{path.name}:{line_number}: invalid JSON: {error}") from error
            text = row.get("text")
            if not isinstance(text, str) or not text.strip():
                raise SystemExit(f"{path.name}:{line_number}: missing non-empty text field")
            count += len(tokenizer.encode(text, add_special_tokens=False))
    return count


def main():
    parser = argparse.ArgumentParser(description="Train a separate experimental Turkish text-adaptation LoRA locally.")
    parser.add_argument("--model", type=Path, default=MODEL_DIR)
    parser.add_argument("--epochs", type=float, default=1.0)
    parser.add_argument("--max-length", type=int, default=512)
    parser.add_argument("--min-train-tokens", type=int, default=1_000_000)
    parser.add_argument("--output", type=Path, default=ROOT / "output" / "yuki-tr-cpt")
    args = parser.parse_args()

    train_file, eval_file = CORPUS / "train.jsonl", CORPUS / "eval.jsonl"
    for path in (train_file, eval_file, args.model / "config.json"):
        if not path.is_file():
            raise SystemExit(f"Required local file not found: {path}")
    if not torch.cuda.is_available():
        raise SystemExit("CUDA NVIDIA GPU not available; no training started.")

    tokenizer = AutoTokenizer.from_pretrained(args.model, use_fast=True, local_files_only=True)
    train_tokens = count_tokens(train_file, tokenizer)
    eval_tokens = count_tokens(eval_file, tokenizer)
    print(f"Train tokens: {train_tokens:,}; held-out eval tokens: {eval_tokens:,}")
    if train_tokens < args.min_train_tokens:
        raise SystemExit(
            f"Corpus too small for the guarded pilot ({train_tokens:,} < {args.min_train_tokens:,} train tokens). "
            "Add more reviewed documents; use --min-train-tokens 0 only for a deliberate smoke test."
        )
    if args.output.exists() and any(args.output.iterdir()):
        raise SystemExit(f"Output already contains files; choose a new --output path: {args.output}")

    dtype = torch.bfloat16 if torch.cuda.is_bf16_supported() else torch.float16
    quantization = BitsAndBytesConfig(
        load_in_4bit=True,
        bnb_4bit_quant_type="nf4",
        bnb_4bit_use_double_quant=True,
        bnb_4bit_compute_dtype=dtype,
    )
    model = AutoModelForCausalLM.from_pretrained(
        args.model,
        quantization_config=quantization,
        torch_dtype=dtype,
        device_map={"": 0},
        low_cpu_mem_usage=True,
        local_files_only=True,
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
        learning_rate=2e-5,
        warmup_steps=5,
        lr_scheduler_type="cosine",
        optim="paged_adamw_8bit",
        max_length=args.max_length,
        completion_only_loss=False,
        dataset_text_field="text",
        packing=True,
        eval_strategy="epoch",
        save_strategy="epoch",
        logging_steps=10,
        gradient_checkpointing=True,
        gradient_checkpointing_kwargs={"use_reentrant": False},
        bf16=dtype == torch.bfloat16,
        fp16=dtype == torch.float16,
        report_to="none",
        seed=42,
        data_seed=42,
        save_total_limit=1,
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
    adapter_dir = args.output / "adapter"
    trainer.save_model(str(adapter_dir))
    tokenizer.save_pretrained(str(adapter_dir))
    print(f"Experimental adapter saved locally: {adapter_dir}")
    print("This is only a text-adaptation pilot; evaluate conversation quality before use.")


if __name__ == "__main__":
    main()
