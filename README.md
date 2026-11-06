# MailGuard

A self-hosted inbound mail gateway with a web dashboard. MailGuard sits in front of your real mail server, screens every message, and relays the clean ones on.

- **Postfix** terminates SMTP and applies block/allow lists, greylisting and rate limits.
- **Amavis + SpamAssassin + ClamAV** scan content for spam and viruses.
- **A compound-rule milter** enforces multi-condition rules (for example *From: domain is X **and** body contains Y*) with a hard SMTP reject.
- **A Node/Express API and React dashboard** show the live mail log, quarantine and queue, and manage blocklists, rules, alerts and reports.

```
Internet ──► Postfix :25/:587 ──► policy service (API) ──► milter ──► Amavis ──► relay host
                                                                         │
                                                                 SpamAssassin + ClamAV

Browser ──► nginx :8010 (http) / :8011 (https) ──► React UI + Express API ──► MariaDB
```

## Requirements

- Docker with the Compose plugin
- A host that can bind ports 25 and 587
- A downstream mail server for MailGuard to relay accepted mail to
- *(optional)* a free [MaxMind GeoLite2](https://www.maxmind.com/en/geolite2/signup) account for the GeoIP map

## Quick start

```bash
# 1. Configure
cp .env.example .env
$EDITOR .env            # replace every CHANGE_ME, set your domains and relay host

# 2. Create a TLS certificate (see below)
# 3. Build and start
docker compose up -d --build
```

The dashboard is at `http://<host>:8010` (or `https://<host>:8011`). Sign in with `ADMIN_EMAIL` / `ADMIN_PASSWORD` from your `.env`.

The first start is slow: ClamAV downloads its signature database before Amavis becomes healthy, and Postfix waits for Amavis.

### Generating secrets

```bash
openssl rand -base64 24 | tr -dc 'A-Za-z0-9'    # DB_PASSWORD, DB_ROOT_PASSWORD, ADMIN_PASSWORD
openssl rand -base64 48 | tr -dc 'A-Za-z0-9'    # JWT_SECRET
openssl rand -hex 32                            # MAILGUARD_INTERNAL_TOKEN
```

`ADMIN_EMAIL` / `ADMIN_PASSWORD` are only used when the database is first initialised. Change the password later from the dashboard.

## TLS certificate

Postfix (STARTTLS) and nginx (HTTPS on :8011) both read `certs/server.crt` and `certs/server.key`. The key is never committed. Create the pair yourself before the first start.

**Self-signed (testing, or internal use):**

```bash
mkdir -p certs
openssl req -x509 -newkey rsa:2048 -nodes -days 3650 \
  -keyout certs/server.key -out certs/server.crt \
  -subj "/CN=mail.example.com/O=MailGuard/C=US" \
  -addext "subjectAltName=DNS:mail.example.com"
chmod 600 certs/server.key
```

Use your real `MAIL_HOSTNAME` for the CN and subjectAltName. Many remote servers will deliver to a self-signed certificate, but some strict senders will not.

**Real certificate (production):** issue one with Let's Encrypt or your CA and put the full chain at `certs/server.crt` and the private key at `certs/server.key`. After renewal, restart so both services pick it up:

```bash
docker compose restart nginx postfix
```

Postfix copies the certificate at container start, so a restart is required.

## Configuration

Everything is in `.env`. The important settings:

| Variable | Meaning |
|---|---|
| `MAIL_HOSTNAME`, `MAIL_DOMAIN` | Public hostname of this gateway and its parent domain |
| `RELAY_DOMAINS` | Comma-separated domains to accept inbound mail for |
| `SMTP_RELAY_HOST`, `SMTP_RELAY_PORT` | Your real mail server; accepted mail is delivered here |
| `ENABLE_CLAMAV`, `ENABLE_SPAMASSASSIN`, `ENABLE_SPF`, `ENABLE_DKIM`, `ENABLE_DMARC` | Feature toggles |
| `MAXMIND_ACCOUNT_ID`, `MAXMIND_LICENSE_KEY` | Enables the GeoLite2 download |
| `ALERT_EMAIL`, `REPORT_EMAIL`, `SMTP_FROM` | Where alerts and scheduled reports are sent from and to |

Per-domain routing can be set in `postfix/maps/transport` if different domains relay to different servers.

Spam thresholds, greylisting, rate limits, blocklists and rules are managed from the dashboard and stored in the database. Fresh installs start with **empty blocklists**.

### GeoIP

MaxMind's licence does not allow redistributing the GeoLite2 database, so it is not in this repository. If both `MAXMIND_*` values are set, the backend downloads `GeoLite2-City.mmdb` into `config/geoip/` on startup. Without them the GeoIP features are simply disabled.

## DNS

Point your domain's MX record at this host. For senders to trust you, publish SPF (and DKIM/DMARC if you also send mail) in public DNS. If your internal DNS is split-horizon, make sure the TXT records exist wherever your resolver looks, or SPF will report `none` for your own domains.

## Operations

```bash
docker compose ps                  # service status
docker compose logs -f postfix     # follow a service
docker compose build backend       # after changing backend source
docker compose up -d backend
```

- **Source is baked into images.** The `backend`, `frontend`, `postfix` and `milter` images copy their source at build time, so edits need `docker compose build <service>` and `up -d`, not just a restart. Amavis bind-mounts its config, so a restart is enough there.
- **After a host reboot** `depends_on` is not honoured when the Docker daemon restarts containers. If the stack comes up broken, run `docker compose down && docker compose up -d`.
- **State** lives in `data/` (database, ClamAV signatures, Amavis, SpamAssassin, the Postfix queue) and `logs/`. Back up `data/db` and `.env`.

## Security notes

- The `backend` container mounts `/var/run/docker.sock` (read-only) so it can restart and inspect the mail containers. Anyone who compromises the API can reach the Docker API, so **do not expose the dashboard to the internet**. Keep it on a trusted network or behind a VPN or an authenticating reverse proxy.
- nginx serves the UI over plain HTTP on :8010 as well as HTTPS on :8011. Use HTTPS for anything beyond a lab.
- Ports 25 and 587 are the only ports meant to be reachable from outside.
- `MAILGUARD_INTERNAL_TOKEN` authenticates Postfix and Amavis to the API. Treat it like a password.

## Development

```
backend/      Express API (routes/, services/, utils/)
frontend/     React + Vite + Tailwind dashboard
postfix/      Postfix image, main.cf.template, policy daemon, log shipper
amavis/       Amavis + SpamAssassin glue
milter/       Python compound-rule milter
mariadb/init/ Schema, seed data and the admin bootstrap (runs on first DB init only)
nginx/        Reverse proxy
```

`test-regex-subject.sh` exercises subject-regex matching end to end. It expects a matching `regex_subject` blocklist rule to already exist (see the script), and it uses the `TEST_RECIPIENT` environment variable for the recipient address.

## License

[Apache License 2.0](LICENSE)
