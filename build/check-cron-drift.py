#!/usr/bin/env python3
"""Asserts vercel.json schedules exactly the jobs the registry declares.

Both files name a cron expression and nothing kept them in step. They had
drifted: export-backup — the daily CSV that portfolios are rebuilt from — and
housekeeping were missing from vercel.json entirely, so on a deployment they
would never have run. No error, no log line, just no backups.

The registry is the source of truth; vercel.json is generated from it. Prints
one line per disagreement and exits 1, or prints nothing and exits 0.
"""

import json
import pathlib
import re
import sys

REGISTRY = pathlib.Path("src/server/jobs/registry.ts")
VERCEL = pathlib.Path("vercel.json")

JOB = re.compile(
    r'name: "([a-z-]+)",\s*\n\s*description: "[^"]*",\s*\n\s*cron: "([^"]+)"'
)


def main() -> int:
    declared = dict(JOB.findall(REGISTRY.read_text()))
    if not declared:
        # A parse failure must not read as "nothing is wrong": the regex is
        # coupled to the registry's formatting and will break if that changes.
        print(f"parsed no jobs out of {REGISTRY} — the check cannot vouch for anything")
        return 1

    crons = json.loads(VERCEL.read_text()).get("crons", [])
    scheduled = {e["path"].removeprefix("/api/cron/"): e["schedule"] for e in crons}

    problems = []
    for name, cron in declared.items():
        if name not in scheduled:
            problems.append(f"{name} is in the registry but not in vercel.json — it would never run")
        elif scheduled[name] != cron:
            problems.append(
                f"{name}: registry says {cron!r}, vercel.json says {scheduled[name]!r}"
            )
    for name in scheduled:
        if name not in declared:
            problems.append(f"vercel.json schedules {name}, which no job in the registry provides")

    for problem in problems:
        print(problem)
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
