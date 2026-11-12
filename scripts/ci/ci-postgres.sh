#!/usr/bin/env bash
# Portable CI Postgres starter. Works on both GitHub-hosted ubuntu-latest and
# the self-hosted catalyst-ci runner image, whatever Postgres major each one
# happens to ship (the self-hosted image preinstalls one; a GitHub-hosted image
# has whatever its distro ships, so 16 on 24.04 and 18 on 26.04). Nothing here
# may assume a specific major — the old pinned `apt-get install postgresql-16`
# failed outright with "Unable to locate package postgresql-16" on a runner
# whose sources only carry a newer one.
#
# Creates a FRESH single-job cluster in a temp dir (initdb), starts it on
# 127.0.0.1:5432 with trust auth, and creates the catalyst role + database.
# Per-job isolation: no shared server, no cross-job state, nothing to clean.
#
# Postgres refuses to run as root, and CI jobs in containers run as root
# (mapped to an unprivileged host user via the user namespace). When root and
# a postgres user exists, cluster commands run via su postgres.
#
# Usage: bash scripts/ci/ci-postgres.sh
# Env overrides: PGDATA_DIR (default mktemp), PGUSER/PGPASSWORD/PGDB/PGPORT.
set -euo pipefail

PGUSER="${PGUSER:-catalyst}"
PGPASSWORD="${PGPASSWORD:-catalyst_dev_password}"
PGDB="${PGDB:-catalyst_db}"
PGPORT="${PGPORT:-5432}"
PGDATA_DIR="${PGDATA_DIR:-$(mktemp -d /tmp/ci-pgdata-XXXXXX)}"

# Highest installed major wins, so a runner that ships 18 uses 18 instead of
# failing to find 16. `sort -Vr` keeps 18 above 9.
find_pg_bin() {
  local d
  while IFS= read -r d; do
    if [ -x "$d/initdb" ]; then echo "$d"; return 0; fi
  done < <(
    ls -d /usr/lib/postgresql/*/bin /usr/pgsql-*/bin 2>/dev/null | sort -Vr || true
  )
  if command -v initdb >/dev/null 2>&1; then dirname "$(command -v initdb)"; return 0; fi
  return 1
}

install_pg() {
  # The distro's default `postgresql` package is the portable choice: it always
  # exists, and its major is whatever the image already supports.
  sudo apt-get update -qq
  if ! sudo apt-get install -y -qq postgresql >/dev/null; then
    # Sources without the metapackage: install the newest server package they
    # do offer (postgresql-18, -17, -16, ...).
    local candidate
    candidate="$(apt-cache -qq search '^postgresql-[0-9]+$' 2>/dev/null \
      | awk '{print $1}' | sort -V | tail -1 || true)"
    if [ -z "$candidate" ]; then
      echo "ci-postgres: no postgresql package available from apt" >&2
      return 1
    fi
    sudo apt-get install -y -qq "$candidate" >/dev/null
  fi
  # A packaged install may start its own cluster on 5432, which would make our
  # initdb cluster fail to bind. The job wants only the throwaway cluster.
  sudo systemctl stop postgresql 2>/dev/null || true
  sudo service postgresql stop 2>/dev/null || true
}

PGBIN="$(find_pg_bin || true)"
if [ -z "$PGBIN" ]; then
  echo "ci-postgres: no postgres binaries found, installing..." >&2
  install_pg
  PGBIN="$(find_pg_bin || true)"
  if [ -z "$PGBIN" ]; then
    echo "ci-postgres: installing Postgres did not produce initdb" >&2
    exit 1
  fi
fi

# Drop privileges for postgres commands when running as root. This runs after
# the install above, because a freshly installed package is what creates the
# postgres user in the first place.
if [ "$(id -u)" = "0" ] && id postgres >/dev/null 2>&1; then
  mkdir -p "$PGDATA_DIR"
  chown -R postgres:postgres "$PGDATA_DIR"
  PG_AS="su postgres -c"
else
  PG_AS="sh -c"
fi

export PATH="$PGBIN:$PATH"
echo "ci-postgres: using binaries in $PGBIN" >&2
echo "ci-postgres: data dir $PGDATA_DIR" >&2

if [ ! -f "$PGDATA_DIR/PG_VERSION" ]; then
  $PG_AS "export PATH='$PGBIN':\$PATH; initdb -D '$PGDATA_DIR' -U postgres --auth=trust >/dev/null"
  printf 'listen_addresses = %s\nport = %s\nunix_socket_directories = %s\n' \
    "'127.0.0.1'" "$PGPORT" "'$PGDATA_DIR'" >> "$PGDATA_DIR/postgresql.conf"
  printf 'host all all 127.0.0.1/32 trust\nlocal all all trust\n' > "$PGDATA_DIR/pg_hba.conf"
  chown -R postgres:postgres "$PGDATA_DIR" 2>/dev/null || true
fi

$PG_AS "export PATH='$PGBIN':\$PATH; pg_ctl -D '$PGDATA_DIR' -l '$PGDATA_DIR/server.log' -w -t 60 start >/dev/null"

SETUP_SQL="$(mktemp /tmp/ci-pgsetup-XXXXXX.sql)"
cat > "$SETUP_SQL" <<EOF
SELECT 'CREATE ROLE "$PGUSER" LOGIN PASSWORD ''$PGPASSWORD'' SUPERUSER' WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '$PGUSER')\gexec
SELECT 'CREATE DATABASE "$PGDB" OWNER "$PGUSER"' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = '$PGDB')\gexec
EOF
chmod 644 "$SETUP_SQL" 2>/dev/null || true
chown postgres:postgres "$SETUP_SQL" 2>/dev/null || true
$PG_AS "export PATH='$PGBIN':\$PATH; psql -h 127.0.0.1 -p '$PGPORT' -U postgres -v ON_ERROR_STOP=1 -f '$SETUP_SQL' >/dev/null"
rm -f "$SETUP_SQL"

echo "ci-postgres: ready at 127.0.0.1:$PGPORT db=$PGDB user=$PGUSER" >&2
echo "DATABASE_URL=postgresql://$PGUSER:$PGPASSWORD@127.0.0.1:$PGPORT/$PGDB"
