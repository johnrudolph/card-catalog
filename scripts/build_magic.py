import json

IN_PATH = "oracle-cards.jsonl"
OUT_PATH = "../data/magic.json"

sets = {}  # code -> {id, name, cards: []}

def card_stats(d):
    if d.get("loyalty"):
        return f"Loyalty {d['loyalty']}"
    if d.get("defense"):
        return f"Defense {d['defense']}"
    if d.get("power") is not None and d.get("toughness") is not None:
        return f"{d['power']}/{d['toughness']}"
    return None

def card_text(d):
    if d.get("card_faces"):
        parts = []
        for f in d["card_faces"]:
            face_text = f.get("oracle_text") or ""
            face_name = f.get("name") or ""
            parts.append(f"[{face_name}] {face_text}".strip())
        return "\n\n".join(p for p in parts if p)
    return d.get("oracle_text") or ""

def card_cost(d):
    if d.get("card_faces"):
        costs = [f.get("mana_cost") for f in d["card_faces"] if f.get("mana_cost")]
        return " // ".join(costs) if costs else None
    return d.get("mana_cost") or None

with open(IN_PATH, encoding="utf-8") as f:
    for line in f:
        line = line.strip()
        if not line:
            continue
        d = json.loads(line)
        if d.get("layout") in ("art_series",):
            continue
        set_code = d.get("set", "unknown")
        set_name = d.get("set_name", set_code)
        if set_code not in sets:
            sets[set_code] = {"id": set_code, "name": set_name, "released": d.get("released_at"), "cards": []}

        extra = {"Rarity": d.get("rarity", "").capitalize()}
        if d.get("flavor_text"):
            flavor = d["flavor_text"]
        elif d.get("card_faces"):
            flavor = next((f.get("flavor_text") for f in d["card_faces"] if f.get("flavor_text")), None)
        else:
            flavor = None

        card = {
            "name": d.get("name"),
            "type": d.get("type_line"),
            "cost": card_cost(d),
            "text": card_text(d),
            "stats": card_stats(d),
            "flavor": flavor,
            "extra": extra,
        }
        sets[set_code]["cards"].append(card)

# order sets by release date, drop the 'released' helper field before writing
ordered = sorted(sets.values(), key=lambda s: s.get("released") or "")
for s in ordered:
    s.pop("released", None)
    s["cards"].sort(key=lambda c: c["name"] or "")

out = {"id": "magic", "name": "Magic: The Gathering", "sets": ordered}

with open(OUT_PATH, "w", encoding="utf-8") as f:
    json.dump(out, f, ensure_ascii=False, separators=(",", ":"))

total = sum(len(s["cards"]) for s in ordered)
print(f"Wrote {len(ordered)} sets, {total} cards to {OUT_PATH}")
