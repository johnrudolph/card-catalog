"""
General cleanup pass applied to every data/<game>.json file:
  1. Drop cards with no meaningful text (empty/null/whitespace-only `text`).
  2. De-dupe identical cards (same name + same text) within a game, keeping
     only the first occurrence across its sets.
  3. Drop any set left with zero cards afterward.
Run after any new game file is added or an existing one is rebuilt.
"""
import json
import sys
from pathlib import Path

DATA_DIR = Path(__file__).parent.parent / "data"

def clean_game(path):
    d = json.load(open(path, encoding="utf-8"))
    seen = set()
    before = 0
    after = 0

    for s in d["sets"]:
        kept = []
        for c in s["cards"]:
            before += 1
            text = (c.get("text") or "").strip()
            if not text:
                continue  # rule 2: no meaningful text
            key = (c.get("name") or "").strip().lower(), text.strip().lower()
            if key in seen:
                continue  # rule 1: exact duplicate already kept elsewhere
            seen.add(key)
            kept.append(c)
            after += 1
        s["cards"] = kept

    d["sets"] = [s for s in d["sets"] if s["cards"]]

    with open(path, "w", encoding="utf-8") as f:
        json.dump(d, f, ensure_ascii=False, separators=(",", ":"))

    return before, after, len(d["sets"])

if __name__ == "__main__":
    targets = sys.argv[1:] or [p for p in DATA_DIR.glob("*.json") if p.name != "index.json"]
    for p in targets:
        p = Path(p)
        before, after, nsets = clean_game(p)
        removed = before - after
        print(f"{p.name}: {before} -> {after} cards ({removed} removed), {nsets} sets remain")
