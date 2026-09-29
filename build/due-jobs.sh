#!/usr/bin/env bash
#
# Prints the scheduled jobs due at a given UTC time, one per line.
#
#     bash build/due-jobs.sh <hour> <minute> <day-of-week>   # dow: 1=Mon .. 7=Sun
#
# The GitHub Actions workflow calls this every 15 minutes. It lives here rather
# than inside the workflow's YAML so it can be tested: build/check-scripts.sh
# sweeps all 672 quarter-hours of a week and fails if any registered job is
# never due. Scheduling logic embedded in a workflow cannot be checked that way,
# and a job that silently never runs is the failure mode that matters — there is
# no error, just a leaderboard that stops updating.
#
# Why not Vercel Cron: the Hobby plan allows two cron jobs at daily granularity.
# This app has nine, three of them sub-daily, so `vercel.json` declaring them
# fails the deployment outright. See docs/deployment.md.
set -euo pipefail

hour="${1:?usage: due-jobs.sh <hour> <minute> <dow>}"
minute="${2:?usage: due-jobs.sh <hour> <minute> <dow>}"
dow="${3:?usage: due-jobs.sh <hour> <minute> <dow>}"

# Strip any leading zero: 08 is an invalid octal literal in arithmetic context.
hour=$((10#${hour}))
minute=$((10#${minute}))
dow=$((10#${dow}))

due=()

# Quotes, on weekday market hours. The window is generous at both ends because
# the application resolves the competition's own timezone; this only has to be
# awake often enough not to miss it.
if [[ ${dow} -le 5 && ${hour} -ge 7 && ${hour} -le 21 ]]; then
    due+=("refresh-prices")
fi

# Reports that are due to go out. Cheap when there are none.
due+=("send-scheduled-reports")

# The official close, then the valuations and leaderboard that read it.
if [[ ${dow} -le 5 && ${hour} -eq 21 && ${minute} -lt 15 ]]; then
    due+=("close-prices")
fi
if [[ ${hour} -eq 22 && ${minute} -lt 15 ]]; then
    due+=("snapshot-valuations")
fi
if [[ ${hour} -eq 22 && ${minute} -ge 15 && ${minute} -lt 30 ]]; then
    due+=("snapshot-leaderboard")
fi

# The day's CSV backup, after the valuations it records.
if [[ ${hour} -eq 22 && ${minute} -ge 45 ]]; then
    due+=("export-backup")
fi

# Monday morning, once Sunday night's leaderboard snapshot exists.
if [[ ${dow} -eq 1 && ${hour} -eq 5 && ${minute} -lt 15 ]]; then
    due+=("build-weekly-report")
fi

if [[ ${minute} -lt 15 ]]; then
    due+=("run-notifications")
fi

# Expired sessions, tokens and old job history.
if [[ ${hour} -eq 2 && ${minute} -ge 30 && ${minute} -lt 45 ]]; then
    due+=("housekeeping")
fi

printf '%s\n' "${due[@]}"
