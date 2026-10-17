#!/bin/sh
# Lance tests/sql/*.sql sur une base PostgreSQL jetable : PGURL=postgres://... sh tests/sql/run.sh
# (la base est vidée : n'utiliser qu'une base de test, jamais celle de Supabase).
set -e
cd "$(dirname "$0")/../.."
for f in tests/sql/*.sql; do
  psql "$PGURL" -q -c 'drop schema public cascade; create schema public;' >/dev/null
  psql "$PGURL" -q -X -f "$f"
done
