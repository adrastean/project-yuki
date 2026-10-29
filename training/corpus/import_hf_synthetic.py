"""Import a reviewed, bounded slice of the ODC-BY Turkish synthetic corpus."""
import json, random, re, unicodedata
from pathlib import Path
from transformers import AutoTokenizer

ROOT = Path(__file__).resolve().parent
RAW = ROOT / "inbox" / "supplemental" / "hf-tr-synthetic-first-20mb.jsonl"
OUT = ROOT / "inbox" / "supplemental" / "curated"
MODEL = ROOT.parent / "models" / "Qwen2.5-3B-Instruct"
TARGET = 1_500_000
PARTS = 4
STOP = set("ve bir bu şu o için ile gibi kadar değil olan olarak daha çok da de ki ne her ancak çünkü fakat ancak sonra önce zaman kendi insan insanlar var yok diye hem veya ama ile".split())

def main():
    tok = AutoTokenizer.from_pretrained(MODEL, use_fast=True, local_files_only=True)
    records, seen = [], set()
    with RAW.open(encoding="utf-8") as f:
        for line in f:
            try:
                row = json.loads(line)
            except json.JSONDecodeError:
                continue
            text = unicodedata.normalize("NFC", str(row.get("text", ""))).strip()
            text = re.sub(r"\r\n?", "\n", text)
            text = re.sub(r"[ \t]+", " ", text)
            if "\ufffd" in text or not 300 <= len(text) <= 9000:
                continue
            words = re.findall(r"[\wÇĞİÖŞÜçğıöşü]+", text.casefold())
            if len(words) < 80 or sum(w in STOP for w in words) < 12:
                continue
            key = re.sub(r"\s+", " ", text).casefold()
            if key in seen:
                continue
            n = len(tok.encode(text, add_special_tokens=False))
            if not 100 <= n <= 1800:
                continue
            seen.add(key)
            records.append((n, text))
    random.Random(20261028).shuffle(records)
    parts, counts = [[] for _ in range(PARTS)], [0] * PARTS
    total = 0
    for n, text in records:
        if total >= TARGET:
            break
        i = min(range(PARTS), key=lambda j: counts[j])
        parts[i].append(text)
        counts[i] += n
        total += n
    OUT.mkdir(parents=True, exist_ok=True)
    for i, texts in enumerate(parts, 1):
        target = OUT / f"synthetic-tr-{i}.txt"
        target.write_text("\n\n".join(texts) + "\n", encoding="utf-8")
    print(f"eligible records={len(records):,}; imported records={sum(map(len,parts)):,}; tokens={total:,}; per-file={counts}")
    print("sample:")
    for text in parts[0][:2]:
        print(text[:350].replace("\n", " "))

if __name__ == "__main__":
    main()
