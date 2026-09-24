#!/usr/bin/env bash
# Spins up a throwaway local Postgres, applies migrations + checks, tears down.
set -euo pipefail
cd "$(dirname "$0")"
PGBIN=${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | tail -1)}
DIR=$(mktemp -d)
chown postgres "$DIR" 2>/dev/null || true
as_pg() { if [ "$(id -u)" = 0 ]; then su postgres -c "$*"; else bash -c "$*"; fi; }
as_pg "$PGBIN/initdb -D $DIR/data -A trust -U postgres" >/dev/null
as_pg "$PGBIN/pg_ctl -D $DIR/data -o '-k $DIR -p 54329 -c listen_addresses=' -l $DIR/log start -w" >/dev/null
trap 'as_pg "$PGBIN/pg_ctl -D $DIR/data stop -m fast" >/dev/null; rm -rf "$DIR"' EXIT
PSQL="psql -h $DIR -p 54329 -U postgres -v ON_ERROR_STOP=1 -q"
$PSQL -f auth_shim.sql
for f in ../migrations/*.sql; do $PSQL -f "$f"; done
$PSQL -f rls_test.sql
