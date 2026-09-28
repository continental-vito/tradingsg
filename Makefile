# The one interface for every task in this repository.
#
# `make ci` is the source of truth for whether this compiles and passes. It is
# what the pre-push hook runs, and it answers in seconds rather than waiting on
# a hosted runner. The GitHub Actions workflow runs the same stages — this repo
# is public, so Linux runner minutes are free — but the local run is the one
# that gates a push.

NPM ?= npm

.DEFAULT_GOAL := help

.PHONY: help ci install dev build start test test-watch lint fmt fmt-check typecheck \
        db-migrate db-reset db-seed db-studio db-clear-demo dev-db \
        ci-postgres worker job hooks clean

## help: list every target
help:
	@grep -hE '^## ' $(MAKEFILE_LIST) | sed 's/^## /  /'

## ci: everything that must pass before a push
#
# Ordering is deliberate: formatting and lint are cheap and catch the most
# common mistakes, typecheck fails with a precise location, tests prove
# behaviour, and the build is last because it is the slowest and a compile
# error would already have shown up as a type error.
ci: fmt-check lint typecheck test scripts build
	@echo ""
	@echo "✅ CI green — safe to push"

## install: install dependencies and generate the Prisma client
install:
	$(NPM) install
	$(NPM) run db:generate

## dev: run the app on http://localhost:3000
dev:
	$(NPM) run dev

## build: production build
build:
	$(NPM) run build

## start: serve the production build
start:
	$(NPM) run start

## test: the full test suite
test:
	$(NPM) run test

## test-watch: tests, re-run on change
test-watch:
	$(NPM) run test:watch

## lint: eslint, warnings are errors
lint:
	npx eslint . --max-warnings 0

## typecheck: tsc with no emit
typecheck:
	$(NPM) run typecheck

## fmt: format in place
fmt:
	$(NPM) run fmt

## fmt-check: fail if anything is unformatted
fmt-check:
	$(NPM) run fmt:check

## scripts: assert this repo's own invariants (no committed secrets, etc.)
scripts:
	bash build/check-scripts.sh

## db-migrate: create and apply a migration from schema changes
db-migrate:
	npx prisma migrate dev

## db-reset: drop the database, re-apply every migration, reseed
db-reset:
	npx prisma migrate reset --force

## db-seed: write the demo competition, stocks and participants
db-seed:
	$(NPM) run db:seed

## db-studio: browse the database
db-studio:
	$(NPM) run db:studio

## db-clear-demo: delete every row the seed created, and nothing else
db-clear-demo:
	npx tsx prisma/clear-demo.ts

## dev-db: a local PostgreSQL, with nothing to install (Ctrl-C to stop)
#
# PGlite — PostgreSQL 18 compiled to WASM — on 127.0.0.1:5433, persisting to
# .pgdata/. Run it in its own terminal. Development, the tests and production
# then all speak PostgreSQL, which they did not when local dev was SQLite.
dev-db:
	node build/pg-server.mjs 5433 .pgdata

## ci-postgres: prove the PostgreSQL deploy path works, with no server to install
#
# Runs the generated Postgres DDL and the application's own client against a
# real PostgreSQL 18 (PGlite over a TCP socket). This is the difference between
# "the schema looks portable" and "it has been run" — see docs/deployment.md.
ci-postgres:
	bash build/ci-postgres.sh

## worker: run the scheduled jobs locally (node-cron)
worker:
	$(NPM) run worker

## job: run one job once, e.g. `make job NAME=refresh-prices`
job:
	$(NPM) run job -- $(NAME)

## hooks: once per clone — install the pre-push CI gate
hooks:
	git config core.hooksPath build/hooks
	@chmod +x build/hooks/pre-push
	@echo "core.hooksPath -> build/hooks"

clean:
	rm -rf .next node_modules/.cache dist
