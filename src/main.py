from __future__ import annotations

import json
from pathlib import Path
from games.genshin import GenshinAdapter
from games.starrail import StarRailAdapter

def main() -> None:
    root = Path(__file__).resolve().parents[1]
    for adapter in (GenshinAdapter(), StarRailAdapter()):
        data = adapter.collect()
        out = root / "data" / f"{adapter.slug}.json"
        out.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(json.dumps(data, ensure_ascii=False, indent=2))
        print(f"\nwritten: {out}")

if __name__ == "__main__":
    main()
