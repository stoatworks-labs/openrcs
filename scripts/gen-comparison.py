#!/usr/bin/env python3
"""Render docs/COMPARISON.md from docs/comparison.json.

The JSON is the only thing anyone edits: one row per feature, and for each
processor family a pair of cells — what the vendor's own control software
offers, and the verdict on openrcs against it. This script turns that into a
markdown page with one table per family and group, because on GitHub a single
nine-column table is unreadable and "what does openrcs do on *my* switcher" is
the question a reader actually has.

The website carries the same JSON (synced, not fetched) and renders it as one
matrix, so the two views can never disagree about a cell.

    python3 scripts/gen-comparison.py          # rewrites docs/COMPARISON.md
    python3 scripts/gen-comparison.py --check  # exit 1 if the .md is stale
"""
import json
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "docs" / "comparison.json"
OUT = ROOT / "docs" / "COMPARISON.md"

STOCK = {"Y": "Yes", "N": "No", "X": "—"}
OPEN = {"F": "**Full**", "P": "**Partial**", "M": "**Missing**", "B": "**Beyond stock**", "X": "—"}
ORDER = ["F", "P", "B", "M", "X"]
LABEL = {"F": "Full", "P": "Partial", "B": "Beyond stock", "M": "Missing", "X": "n/a"}


def esc(s: str) -> str:
    # A pipe would split the cell; nothing else in the JSON needs escaping.
    return s.replace("|", "\\|")


def cell(word: str, text: str) -> str:
    return f"{word} — {esc(text)}" if text else word


def render(doc: dict) -> str:
    counts = {p["id"]: Counter() for p in doc["platforms"]}
    for g in doc["groups"]:
        for row in g["rows"]:
            for pid, c in row["cells"].items():
                counts[pid][c["openrcs"]["state"]] += 1
    total = sum(len(g["rows"]) for g in doc["groups"])

    o = []
    o.append("# How openrcs compares with the stock control software\n")
    o.append("<!-- Generated from docs/comparison.json by scripts/gen-comparison.py. Edit the JSON, not this file. -->\n")
    o.append(f"{doc['intro']}\n")
    o.append(f"This page describes **{doc['subject']} {doc['version']}** (`{doc['commit']}`) as of {doc['date']}, "
             f"read from the views the app actually shows for each family and the device variables each one drives. "
             f"The vendor columns are read from the current manuals, not from a running unit:\n")
    for p in doc["platforms"]:
        o.append(f"- **{p['name']}** ({p['models']}) — {p['tool']}: {p['source']}")
    o.append("")

    o.append("## Standing\n")
    o.append(f"{total} features. For each family, how many openrcs matches, covers in part, goes past, or lacks.\n")
    o.append("| Family | Stock tool | Full | Partial | Beyond stock | Missing | n/a |")
    o.append("|---|---|--:|--:|--:|--:|--:|")
    for p in doc["platforms"]:
        c = counts[p["id"]]
        o.append(f"| {p['name']} | {p['tool']} | {c['F']} | {c['P']} | {c['B']} | {c['M']} | {c['X']} |")
    o.append("")
    o.append("**Full** — openrcs matches the stock tool. **Partial** — some of it. **Missing** — the stock tool has it, "
             "openrcs does not. **Beyond stock** — openrcs offers something the stock tool has no equivalent for; "
             "it does not mean the openrcs version wins on every axis. A dash means the platform has no such thing.\n")

    for p in doc["platforms"]:
        pid = p["id"]
        o.append(f"## {p['name']} — against the {p['tool']}\n")
        o.append(f"*{p['models']}.*\n")
        for g in doc["groups"]:
            o.append(f"### {g['name']}\n")
            o.append(f"| Feature | {p['tool']} | openrcs |")
            o.append("|---|---|---|")
            for row in g["rows"]:
                c = row["cells"][pid]
                s, oc = c["stock"], c["openrcs"]
                o.append(f"| {esc(row['feature'])} | {cell(STOCK[s['state']], s['text'])} | "
                         f"{cell(OPEN[oc['state']], oc['text'])} |")
            o.append("")

    o.append("---\n")
    o.append("Mnemonics in the cells (`PMcat`, `OSaup`, `GCsta`) name the device variable a view is built on, so a row "
             "can be checked against the [protocol reference](https://github.com/stoatworks-labs/openrcs-protocol). "
             "Not affiliated with or endorsed by Analog Way; product names are used only to describe compatibility.\n")
    return "\n".join(o)


def main(argv: list[str]) -> int:
    doc = json.loads(SRC.read_text())
    text = render(doc)
    if "--check" in argv:
        if OUT.exists() and OUT.read_text() == text:
            return 0
        print(f"{OUT.relative_to(ROOT)} is stale — run scripts/gen-comparison.py", file=sys.stderr)
        return 1
    OUT.write_text(text)
    print(f"wrote {OUT.relative_to(ROOT)}: {sum(len(g['rows']) for g in doc['groups'])} rows")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
