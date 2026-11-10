"""英和辞書データ (data/dict.json) を作るスクリプト。

使い方:
    python -I tools/build_dict.py <EJDictのフォルダ> <en_full.txtのパス>

データ元:
  - EJDict-hand (kujirahand/EJDict) … パブリックドメイン(CC0) の英和辞書
  - FrequencyWords en_full (hermitdave) … 英語の出現頻度ランキング
    (頻度リストは「マイナーすぎる単語を除く」「レベル分け」にだけ使い、配布物には順位のみ入れる)

出力形式: [[word, 短い意味, 全部の意味, 頻度順位, レベル(1-6), 出題OKフラグ], ...]
"""
import json
import re
import sys
from pathlib import Path

ej_dir = Path(sys.argv[1])
freq_path = Path(sys.argv[2])
out_path = Path(__file__).resolve().parent.parent / "data" / "dict.json"

MAX_RANK = 100000  # これより低頻度の単語は「マイナーすぎる」として除外

rank = {}
for i, line in enumerate(freq_path.read_text(encoding="utf-8").splitlines(), 1):
    w = line.split(" ")[0].strip().lower()
    if w and w not in rank:
        rank[w] = i

basic = set()
for name in ("100.txt", "850.txt", "2000.txt"):
    p = ej_dir / "frequency" / name
    if p.exists():
        basic |= {l.strip().lower() for l in p.read_text(encoding="utf-8").splitlines() if l.strip()}

WORD_RE = re.compile(r"^[a-z][a-z\-]*[a-z]$|^[a-z]$")
CAP_RE = re.compile(r"^[A-Z][a-z]+$")              # Monday, English など (辞書のみ)
PHRASE_RE = re.compile(r"^[a-z][a-z\-']*( [a-z][a-z\-']*)+$")  # 熟語 (辞書のみ)
# 活用形・参照だけのエントリは出題しない
INFLECTION_RE = re.compile(r"(の過去|過去分詞|の複数|三人称|現在分詞|の比較級|の最上級|の短縮形|の変形|の異形|の古形|=)")


def short_meaning(full: str) -> str:
    s = full.split(" / ")[0]
    s = s.split(";")[0]
    s = re.sub(r"《[^》]*》", "", s)
    s = re.sub(r"〈[CU]〉", "", s)
    s = s.replace("『", "").replace("』", "").replace("〈", "").replace("〉", "")
    s = re.sub(r"\([^)]*\)$", "", s).strip(" ,，")
    parts = [p.strip() for p in s.split(",") if p.strip()]
    s = "、".join(parts[:2]) if parts else s
    return s[:28]


def level_of(r: int) -> int:
    if r <= 1500:
        return 1
    if r <= 4000:
        return 2
    if r <= 9000:
        return 3
    if r <= 20000:
        return 4
    if r <= 45000:
        return 5
    return 6


entries = {}
for f in sorted((ej_dir / "src").glob("*.txt")):
    for line in f.read_text(encoding="utf-8").splitlines():
        if "\t" not in line:
            continue
        word, meaning = line.split("\t", 1)
        word = word.strip()
        meaning = meaning.strip()
        # 同じ綴りの見出しが複数あるとき(例: "bear, bore, borne")は先頭だけ
        word = word.split(",")[0].strip()
        if CAP_RE.match(word) or PHRASE_RE.match(word):
            # 固有名詞・熟語は辞書検索用 (ルーレット・テストには出さない)
            parts = word.lower().split(" ")
            rs = [rank.get(x) for x in parts]
            if None in rs or max(rs) > MAX_RANK or word in entries:
                if word in entries:
                    entries[word][2] += " / " + meaning
                continue
            r = max(rs)
            entries[word] = [word, short_meaning(meaning), meaning, r, level_of(r), 0]
            continue
        if not WORD_RE.match(word):
            continue
        r = rank.get(word)
        if r is None:
            if word in basic:
                r = 3000
            else:
                continue
        if r > MAX_RANK:
            continue
        if word in entries:
            entries[word][2] += " / " + meaning
            continue
        quiz = 0 if INFLECTION_RE.search(meaning.split(" / ")[0]) else 1
        if len(word) <= 2:  # re, ox などは出題しない
            quiz = 0
        sm = short_meaning(meaning)
        if not sm:
            quiz = 0
        entries[word] = [word, sm, meaning, r, level_of(r), quiz]

def base_candidates(w: str):
    """-ed / -ing 形から考えられる原形の候補"""
    out = []
    for suf in ("ing", "ed"):
        if w.endswith(suf) and len(w) > len(suf) + 2:
            b = w[: -len(suf)]
            out += [b, b + "e"]
            if len(b) > 2 and b[-1] == b[-2]:
                out.append(b[:-1])  # humming -> hum
            if suf == "ed" and b.endswith("i"):
                out.append(b[:-1] + "y")  # carried -> carry
    if w.endswith("ed"):
        out.append(w[:-1])  # used -> use
    return out


# 原形が辞書にある -ed/-ing 形はルーレット・テストに出さない(辞書検索には残す)
for w, e in entries.items():
    if e[5] and w.islower() and " " not in w and any(b in entries for b in base_candidates(w)):
        e[5] = 0

# 検索用に小文字順 (同じ綴りなら小文字の単語を先に)
data = sorted(entries.values(), key=lambda e: (e[0].lower(), e[0] != e[0].lower()))
out_path.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

from collections import Counter
c = Counter(e[4] for e in data if e[5])
print("total", len(data), "words", sum(1 for e in data if e[0].islower() and " " not in e[0]), "caps", sum(1 for e in data if e[0][0].isupper()), "phrases", sum(1 for e in data if " " in e[0]), "quizable by level", dict(sorted(c.items())))
print("size MB", round(out_path.stat().st_size / 1e6, 2))
