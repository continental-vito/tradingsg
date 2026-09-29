#!/usr/bin/env python3
"""Asserts every scheduled job actually gets scheduled, and that vercel.json
cannot break a Hobby-plan deployment.

Two failures this guards against, both silent:

1. A job exists in the registry but nothing ever triggers it. There is no
   error — the job simply never runs, and the first symptom is a leaderboard
   that stopped updating or backups that were never written. `export-backup`
   and `housekeeping` were in exactly this state until they were noticed by
   hand.

2. vercel.json declares a sub-daily cron. Vercel's Hobby plan allows two cron
   jobs at daily granularity and REFUSES THE DEPLOYMENT outright:

     Error: Hobby accounts are limited to daily cron jobs. This cron expression
     (*/15 8-22 * * 1-5) would run more than once per day.

   So a cron added to vercel.json does not degrade, it stops the site shipping.
   Scheduling lives in .github/workflows/scheduled-jobs.yml instead, which works
   on any plan.

Scheduling is checked by simulation, not by reading: every quarter-hour of a
full week is fed to build/due-jobs.sh and the union of what comes back must
cover the registry.
"""

import json
import pathlib
import re
import subprocess
import sys

REGISTRY = pathlib.Path("src/server/jobs/registry.ts")
VERCEL = pathlib.Path("vercel.json")
WORKFLOW = pathlib.Path(".github/workflows/scheduled-jobs.yml")
DUE = "build/due-jobs.sh"

JOB = re.compile(r'name: "([a-z-]+)",\s*\n\s*description: "[^"]*",\s*\n\s*cron: "([^"]+)"')


def registered() -> dict[str, str]:
    jobs = dict(JOB.findall(REGISTRY.read_text()))
    if not jobs:
        # A parse failure must not read as "nothing is wrong": the regex is
        # coupled to the registry's formatting.
        raise SystemExit(f"parsed no jobs out of {REGISTRY} — this check cannot vouch for anything")
    return jobs


def reachable() -> set[str]:
    """Every job name build/due-jobs.sh emits across a full week."""
    seen: set[str] = set()
    for dow in range(1, 8):
        for hour in range(24):
            for minute in (0, 15, 30, 45):
                out = subprocess.run(
                    ["bash", DUE, str(hour), str(minute), str(dow)],
                    capture_output=True, text=True, check=True,
                )
                seen.update(line for line in out.stdout.split() if line)
    return seen


def main() -> int:
    problems: list[str] = []
    jobs = registered()

    never = sorted(set(jobs) - reachable())
    for name in never:
        problems.append(f"{name} is registered but build/due-jobs.sh never emits it — it would never run")

    unknown = sorted(reachable() - set(jobs))
    for name in unknown:
        problems.append(f"build/due-jobs.sh emits {name}, which no job in the registry provides")

    # The workflow's manual-run dropdown should offer every job, or a job cannot
    # be triggered by hand when something needs re-running.
    if WORKFLOW.exists():
        workflow = WORKFLOW.read_text()
        for name in jobs:
            if f"- {name}" not in workflow:
                problems.append(f"{name} is missing from the workflow_dispatch choices in {WORKFLOW.name}")

    # A cron here is not a smaller version of the schedule — it is a failed
    # deployment on the Hobby plan.
    crons = json.loads(VERCEL.read_text()).get("crons", []) if VERCEL.exists() else []
    if crons:
        problems.append(
            f"vercel.json declares {len(crons)} cron(s). Hobby allows two, daily only, and rejects "
            "the deployment otherwise — scheduling belongs in .github/workflows/scheduled-jobs.yml"
        )

    for problem in problems:
        print(problem)
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
