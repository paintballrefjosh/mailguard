#!/bin/bash
# Runs inside the MariaDB container on first init.
# Hashes ADMIN_PASSWORD with bcrypt (python3-bcrypt is installed by the
# Dockerfile) and inserts the initial admin user. Refuses to run without an
# explicit ADMIN_PASSWORD so no default credential is ever created.

set -euo pipefail

EMAIL="${ADMIN_EMAIL:-admin@example.com}"

if [ -z "${ADMIN_PASSWORD:-}" ]; then
  echo "[03-admin] ERROR: ADMIN_PASSWORD is not set — set it in .env before first start." >&2
  exit 1
fi

export ADMIN_PASSWORD
HASH=$(python3 -c "import bcrypt, os; print(bcrypt.hashpw(os.environ['ADMIN_PASSWORD'].encode(), bcrypt.gensalt(12)).decode())")

mariadb -u root -p"${MYSQL_ROOT_PASSWORD}" "${MYSQL_DATABASE}" <<SQL
INSERT INTO users (email, password, role)
VALUES ('${EMAIL}', '${HASH}', 'admin')
ON DUPLICATE KEY UPDATE password=VALUES(password);
SQL

echo "[03-admin] Admin user '${EMAIL}' initialised."
