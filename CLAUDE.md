# MailGuard — notes for Claude

Self-hosted inbound mail gateway: Postfix → policy service (backend API) → compound-rule milter → Amavis (SpamAssassin + ClamAV) → relay host. Express API + React dashboard + MariaDB. Everything runs under `docker-compose.yml`. See `README.md` for setup and architecture.

## Layout

- `backend/` — Express API. `routes/` (one file per `/api/*` area, wired in `server.js`), `services/` (scheduler, geoip, alerts, reports, websocket), `utils/postfix-rules.js` and `utils/compound-rules.js` (render DB rules into files under `postfix/maps-dynamic/`).
- `frontend/` — React + Vite + Tailwind. Pages in `src/pages/`, mail-log row menu is `RowMenu` in `pages/Events.jsx`.
- `postfix/` — `main.cf.template` + `entrypoint.sh` render the config at container start; `policy-check.py` (policy daemon) and `log-shipper.py` (ships mail log to the API).
- `amavis/`, `milter/` (`mg_milter.py`), `mariadb/init/` (numbered SQL, runs on **first DB init only**), `nginx/`.
- `postfix/maps/` — static maps; `*.db`/`*.lmdb` are generated and git-ignored. `postfix/maps-dynamic/` is backend-generated and git-ignored.

## Gotchas (learned the hard way)

- **Source is baked into images** for `backend`, `frontend`, `postfix` and `milter`. After editing their files run `docker compose build <svc> && docker compose up -d <svc>`; a restart will not pick up changes. Amavis bind-mounts its config, so a restart is enough there.
- **Postfix template/entrypoint** changes need `docker compose build postfix`, not a restart.
- **After a host reboot** the stack can come up broken because `depends_on` is not honoured on daemon restart. Fix: `docker compose down && docker compose up -d`.
- **Compound rules** (multi-condition, e.g. From: domain AND body) are enforced by the `milter` service from the `rules` table (via `compound_rules.json`), not by blocklists or Postfix maps.
- **A trusted-client `OK`** in `postfix/maps/client_access` (e.g. Google ranges) bypasses *all* later blocklist checks, so the policy service must be ordered before `check_client_access`. The `domain` blocklist type is exact-match only; it does not cover subdomains.
- **Split-horizon DNS**: the internal zone may lack the public SPF/DMARC TXT records, so Amavis can report `SPF_NONE` for the operator's own domains.
- Blocklist rows are looked up via `POST /api/blocklists/lookup` (exact `list_type` + case-insensitive value); the mail-log Quick Block menu uses it to show existing rules and their action.

## Conventions

- No secrets in the repo. Config comes from `.env` (see `.env.example`); never commit `.env`, `certs/*.key`, `data/`, `logs/` or the GeoLite2 database.
- Use RFC 5737 / `example.com` placeholders in docs, comments and tests — never real domains, addresses or IPs.
- Fresh installs ship with empty blocklists; do not add seed blocklist data to `mariadb/init/`.
- Init SQL only runs against an empty database. Schema changes for existing installs need a new numbered file *and* a manual migration path.
- The backend mounts the Docker socket read-only; keep the dashboard off the public internet.

## Common commands

```bash
docker compose ps
docker compose logs -f <service>
docker compose build backend && docker compose up -d backend
bash test-regex-subject.sh        # needs a matching regex_subject rule; set TEST_RECIPIENT
```
