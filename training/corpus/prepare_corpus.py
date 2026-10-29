"""Prepare a rights-tracked, deduplicated local Turkish text corpus."""

import argparse
import hashlib
import json
import re
import unicodedata
from pathlib import Path


HERE = Path(__file__).resolve().parent
INBOX = HERE / "inbox"
SOURCES = HERE / "sources.jsonl"
OUTPUT = HERE / "processed"
ALLOWED_LICENSES = {"public-domain", "cc0", "cc-by", "cc-by-sa", "odc-by", "own", "permission"}


def read_sources():
    if not SOURCES.is_file():
        raise SystemExit(f"Source manifest not found: {SOURCES}\nCopy sources.example.jsonl to sources.jsonl and edit it.")
    entries = []
    seen_files = set()
    for number, raw in enumerate(SOURCES.read_text(encoding="utf-8").splitlines(), start=1):
        if not raw.strip():
            continue
        try:
            item = json.loads(raw)
        except json.JSONDecodeError as error:
            raise SystemExit(f"sources.jsonl:{number}: invalid JSON: {error}") from error
        required = ("file", "title", "source_url", "license", "rights_basis", "attribution")
        missing = [key for key in required if not str(item.get(key, "")).strip()]
        if missing:
            raise SystemExit(f"sources.jsonl:{number}: missing fields: {', '.join(missing)}")
        filename = str(item["file"])
        if filename in seen_files:
            raise SystemExit(f"sources.jsonl:{number}: duplicate file entry: {filename}")
        seen_files.add(filename)
        license_name = str(item["license"]).strip().lower()
        if license_name not in ALLOWED_LICENSES:
            raise SystemExit(f"sources.jsonl:{number}: unsupported rights label: {license_name}")
        path = (INBOX / filename).resolve()
        if not path.is_relative_to(INBOX.resolve()):
            raise SystemExit(f"sources.jsonl:{number}: file must stay inside corpus/inbox")
        if path.suffix.lower() not in {".txt", ".md"}:
            raise SystemExit(f"sources.jsonl:{number}: use UTF-8 .txt or .md files only")
        if not path.is_file():
            raise SystemExit(f"sources.jsonl:{number}: source file not found: {path}")
        item["license"] = license_name
        item["_path"] = path
        entries.append(item)
    if len(entries) < 2:
        raise SystemExit("Add at least two separate source documents so one can be held out for evaluation.")
    return entries


def clean_paragraphs(raw_text):
    text = unicodedata.normalize("NFC", raw_text).replace("\r\n", "\n").replace("\r", "\n").replace("\x00", "")
    paragraphs = []
    for block in re.split(r"\n\s*\n+", text):
        clean = " ".join(line.strip() for line in block.splitlines() if line.strip())
        clean = re.sub(r"\s+", " ", clean).strip()
        if clean:
            paragraphs.append(clean)
    return paragraphs


def chunks_from_paragraphs(paragraphs, max_chars):
    chunks = []
    current = ""
    for paragraph in paragraphs:
        pieces = [paragraph]
        if len(paragraph) > max_chars:
            words = paragraph.split()
            pieces, piece = [], ""
            for word in words:
                if piece and len(piece) + len(word) + 1 > max_chars:
                    pieces.append(piece)
                    piece = word
                else:
                    piece = f"{piece} {word}".strip()
            if piece:
                pieces.append(piece)
        for piece in pieces:
            if current and len(current) + len(piece) + 2 > max_chars:
                chunks.append(current)
                current = piece
            else:
                current = f"{current}\n\n{piece}".strip()
    if current:
        chunks.append(current)
    return chunks


def main():
    parser = argparse.ArgumentParser(description="Prepare a local Turkish text corpus with source and rights metadata.")
    parser.add_argument("--max-chars", type=int, default=2800)
    parser.add_argument("--min-chars", type=int, default=180)
    args = parser.parse_args()
    if args.max_chars < 500 or args.min_chars < 1 or args.min_chars >= args.max_chars:
        raise SystemExit("Use --max-chars >= 500 and 1 <= --min-chars < --max-chars.")

    entries = read_sources()
    ordered = sorted(entries, key=lambda item: hashlib.sha256(item["file"].encode("utf-8")).hexdigest())
    eval_count = max(1, round(len(ordered) * 0.05))
    eval_files = {item["file"] for item in ordered[:eval_count]}
    rows = {"train": [], "eval": []}
    seen_chunks = set()
    source_counts = {"train": set(), "eval": set()}

    for item in entries:
        raw = item["_path"].read_text(encoding="utf-8-sig")
        paragraphs = clean_paragraphs(raw)
        split = "eval" if item["file"] in eval_files else "train"
        for chunk in chunks_from_paragraphs(paragraphs, args.max_chars):
            if len(chunk) < args.min_chars:
                continue
            digest = hashlib.sha256(chunk.casefold().encode("utf-8")).hexdigest()
            if digest in seen_chunks:
                continue
            seen_chunks.add(digest)
            rows[split].append({
                "text": chunk,
                "source_file": item["file"],
                "title": item["title"],
                "source_url": item["source_url"],
                "license": item["license"],
                "rights_basis": item["rights_basis"],
                "attribution": item["attribution"],
            })
            source_counts[split].add(item["file"])

    if not rows["train"] or not rows["eval"]:
        raise SystemExit("No usable train/eval chunks. Add longer clean documents or adjust --min-chars.")
    OUTPUT.mkdir(parents=True, exist_ok=True)
    for split, split_rows in rows.items():
        target = OUTPUT / f"{split}.jsonl"
        with target.open("w", encoding="utf-8", newline="\n") as output:
            for row in split_rows:
                output.write(json.dumps(row, ensure_ascii=False) + "\n")
    print(f"Train: {len(rows['train']):,} chunks from {len(source_counts['train'])} documents")
    print(f"Eval:  {len(rows['eval']):,} chunks from {len(source_counts['eval'])} held-out documents")
    print(f"Output: {OUTPUT}")
    print("No TDK database was downloaded or copied. All text remains local.")


if __name__ == "__main__":
    main()
