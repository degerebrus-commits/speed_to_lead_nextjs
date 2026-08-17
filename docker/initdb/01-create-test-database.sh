#!/bin/sh
# Runs once, on first initialisation of the data volume.
#
# The test suite truncates tables, so it needs a database of its own rather
# than sharing the one holding seeded development data. The name is derived
# from POSTGRES_DB so this works for any client deployment.
set -e

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<SQL
  CREATE DATABASE "${POSTGRES_DB}_test";
SQL

echo "Created test database: ${POSTGRES_DB}_test"
