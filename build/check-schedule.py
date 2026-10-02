#!/usr/bin/env python3
"""Asserts every scheduled job actually gets scheduled, and that vercel.json
cannot break a Hobby-plan deployment.

Every job runs from one of the chains in src/server/jobs/chains.ts, and each
chain is fired by a daily Vercel Cron. Three failures this guards against, all
silent:

1. A job exists in the registry but no chain runs it. There is no error — the
   job simply never runs, and the first symptom is a leaderboard that stopped
   updating. `export-backup` and `housekeeping` were in exactly this state
   once, and the close/valuation/leaderboard jobs were again when a GitHub
   Actions `*/15` schedule turned out to fire only every four to six hours.

2. A cron points at a path no chain answers, which 404s every night.

3. vercel.json declares a sub-daily cron, or more than two. Vercel's Hobby plan
   REFUSES THE DEPLOYMENT outright rather than running a reduced schedule:

     Error: Hobby accounts are limited to daily cron jobs. This cron expression
     (*/15 8-22 * * 1-5) would run more than once per day.
"""

import json
import pathlib
import re
import sys

REGISTRY = pathlib.Path("src/server/jobs/registry.ts")
CHAINS = pathlib.Path("src/server/jobs/chains.ts")
VERCEL = pathlib.Path("vercel.json")
WORKFLOW = pathlib.Path(".github/workflows/scheduled-jobs.yml")

JOB = re.compile(r'name: "([a-z-]+)",\s*\n\s*description: "[^"]*",\s*\n\s*cron: "([^"]+)"')
CHAIN = re.compile(r"^\s*([a-z]+): \[(.*?)\]", re.S | re.M)
DAILY = re.compile(r"^\d{1,2} \d{1,2} \* \* [\d*,-]+$")


def parsed(what: str, value):
    # A parse failure must not read as "nothing is wrong": both regexes are
    # coupled to the formatting of the files they read.
    if not value:
        raise SystemExit(f"parsed no {what} — this check cannot vouch for anything")
    return value


def main() -> int:
    problems: list[str] = []
    jobs = parsed(f"jobs out of {REGISTRY}", dict(JOB.findall(REGISTRY.read_text())))
    chains = parsed(
        f"chains out of {CHAINS}",
        {name: re.findall(r'"([a-z-]+)"', body) for name, body in CHAIN.findall(CHAINS.read_text())},
    )
    crons = json.loads(VERCEL.read_text()).get("crons", []) if VERCEL.exists() else []

    fired: set[str] = set()
    for cron in crons:
        path, schedule = cron.get("path", ""), cron.get("schedule", "")
        if not DAILY.match(schedule):
            problems.append(
                f"vercel.json cron {path} runs on '{schedule}' — Hobby allows daily only and "
                "rejects the whole deployment otherwise"
            )
        chain = path.removeprefix("/api/cron/")
        if chain not in chains:
            problems.append(f"vercel.json cron {path} names no chain in {CHAINS.name} — it would 404")
        else:
            fired.add(chain)
    if len(crons) > 2:
        problems.append(f"vercel.json declares {len(crons)} crons; the Hobby plan allows two")

    covered = {job for chain in fired for job in chains[chain]}
    for name in sorted(set(jobs) - covered):
        problems.append(f"{name} is registered but no cron-fired chain runs it — it would never run")
    for chain, members in chains.items():
        for name in members:
            if name not in jobs:
                problems.append(f"chain {chain} runs {name}, which no job in the registry provides")

    # The workflow's manual-run dropdown should offer every job and chain, or
    # something cannot be re-run by hand when it needs to be.
    if WORKFLOW.exists():
        workflow = WORKFLOW.read_text()
        for name in [*jobs, *chains]:
            if f"- {name}" not in workflow:
                problems.append(f"{name} is missing from the workflow_dispatch choices in {WORKFLOW.name}")

    for problem in problems:
        print(problem)
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
