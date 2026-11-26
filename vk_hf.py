#!/usr/bin/env python3
"""Voight-Kampff data on Hugging Face: the monthly files and a dataset card.

Her pick 2026-11-26: "GitHub + Hugging Face". The account is hers to make; its write token
goes in the token store as HUGGINGFACE_TOKEN (~/.claude/bin/token save HUGGINGFACE_TOKEN).

    python3 vk_hf.py --repo <user-or-org>/voight-kampff     # card + every month in the GitHub releases
    python3 vk_hf.py --repo <...> --month 2026-11

Files land as data/bots-<month>.parquet and data/people-<month>.csv.gz, the same files as the
GitHub release for that month (NaNoBotCo/voight-kampff-data), so the dataset viewer reads them.
"""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))
import vk_export as X  # noqa: E402

GH = X.REPO
WORK = ROOT / "data" / "voight-kampff" / "export" / "hf"


def token() -> str:
    r = subprocess.run([str(Path.home() / ".claude" / "bin" / "token"), "get", "HUGGINGFACE_TOKEN"], capture_output=True, text=True)
    if r.returncode or not r.stdout.strip():
        sys.exit("no HUGGINGFACE_TOKEN in the token store")
    return r.stdout.strip()


def card(repo: str, months: list[str]) -> str:
    ix = X.get_json("index.json") or {"days": []}
    days = ix["days"]
    rows = sum(d["rows"] for d in days)
    fields = "\n".join(f"| `{n}` | {t} | {w} |" for n, t, w in X.BOT_FIELDS)
    pfields = "\n".join(f"| `{n}` | {t} | {w} |" for n, t, w in X.PEOPLE_FIELDS)
    return f"""---
license: cc-by-4.0
pretty_name: Voight-Kampff — every bot request to motdang.net
tags:
- web-crawlers
- bots
- ai-crawlers
- tls-fingerprinting
- web-traffic
- logs
size_categories:
- 10M<n<100M
configs:
- config_name: bots
  data_files: "data/bots-*.parquet"
  default: true
- config_name: people
  data_files: "data/people-*.csv.gz"
---

# Voight-Kampff: every bot request to motdang.net

Every request bots made to [motdang.net](https://motdang.net) (a map and directory of Chiang Mai, in Thai and
English) and hongdam.net, one row each, to the second, from 8 Sept 2026: {rows:,} rows to {days[-1]['day'] if days else ''}.
From 26 Nov 2026 each row also carries the caller's network, the Cloudflare data centre that answered, its TLS
fingerprints (SHA-1 of the cipher list and of the extensions) and the TCP round trip.

People appear only as counts per hour, page and country, in the `people` config.

- Daily files, refreshed each night: https://motdang.net/voight-kampff/data/
- Monthly releases on GitHub: https://github.com/{GH}/releases
- Ask it in your browser with SQL: https://motdang.net/voight-kampff/#ask
- What the site makes of it, every night and every week: https://motdang.net/voight-kampff/

The log is Cloudflare Workers Analytics Engine, written by the site's own Worker on every request. When busy it
stores one row in N and says so in `weight`: requests = `SUM(weight * counted)`. No addresses are logged.

## bots

| field | type | what |
|---|---|---|
{fields}

## people

| field | type | what |
|---|---|---|
{pfields}

## Licence

CC BY 4.0. Credit: motdang.net Voight-Kampff, https://motdang.net/voight-kampff/
"""


def months_released() -> list[str]:
    r = subprocess.run(["gh", "release", "list", "-R", GH, "--json", "tagName", "-L", "200"], capture_output=True, text=True)
    return sorted(x["tagName"] for x in json.loads(r.stdout or "[]"))


def main() -> None:
    args = sys.argv[1:]
    repo = args[args.index("--repo") + 1]
    months = [args[args.index("--month") + 1]] if "--month" in args else months_released()
    from huggingface_hub import HfApi
    api = HfApi(token=token())
    api.create_repo(repo, repo_type="dataset", exist_ok=True)
    WORK.mkdir(parents=True, exist_ok=True)
    for m in months:
        subprocess.run(["gh", "release", "download", m, "-R", GH, "-D", str(WORK), "--clobber",
                        "-p", "voight-kampff-*"], check=True)
        for kind, ext in (("bots", "parquet"), ("people", "csv.gz")):
            f = WORK / f"voight-kampff-{kind}-{m}.{ext}"
            api.upload_file(path_or_fileobj=str(f), path_in_repo=f"data/{kind}-{m}.{ext}", repo_id=repo,
                            repo_type="dataset", commit_message=f"{kind}, {m}")
            f.unlink()
        print("hf:", m)
    (WORK / "README.md").write_text(card(repo, months))
    api.upload_file(path_or_fileobj=str(WORK / "README.md"), path_in_repo="README.md", repo_id=repo,
                    repo_type="dataset", commit_message="Dataset card")
    print(f"https://huggingface.co/datasets/{repo}")


if __name__ == "__main__":
    main()
