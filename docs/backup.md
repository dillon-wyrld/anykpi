# Backup

Your data is yours. ANYKPI stores it on the machine you host. There is no telemetry and nothing leaves unless you approve a PMF+ research query.

Two backed-up copies cover different jobs:

1. **`anykpi export`** — portable JSON or CSV of users, events, and read models
2. **A SQLite snapshot** — the whole database file, including encrypted source config

## Export command

```bash
# JSON on stdout (or --out backup.json)
anykpi export --workspace live

# CSV files that `anykpi import` can reload
anykpi export --format csv --out ./backup --workspace live
```

The CSV directory includes `users.csv`, `events.csv`, and one file per read-model table (revenue, calendar, balances, WBR metrics).

### What import restores

`anykpi import` (POST `/api/v1/import`) writes **users and events only**. A workspace built from the SDK or from CSV round-trips:

```bash
anykpi export --format csv --out ./backup --workspace live
# wipe or start a fresh database
anykpi import ./backup/users.csv --kind=users --workspace live
anykpi import ./backup/events.csv --kind=events --workspace live
```

View numbers that come from people and activity (dot plot, cohorts, overview user counts) match after that reload.

### What import does not restore

CSV import writes users and events only. **Connector-backed read models restore by re-syncing the source.** After credentials are stored again (`anykpi connect` or `/connect`), run:

```bash
anykpi sync --workspace live
```

Revenue, calendar, and balance rows come back from the connected source. Do not expect `anykpi import` to refill those tables.

JSON/CSV export does not include API keys or source credentials.

## SQLite snapshot

The database is the SQLite file at `DATABASE_PATH` (default `./data/anykpi.db`, or `/data/anykpi.db` in Docker). Keep `anykpi.config.json` and `research-cache.json` from the same directory if you use them.

Use the SQLite backup API so WAL mode (`anykpi.db-wal`, `anykpi.db-shm`) is folded into one consistent file:

```bash
mkdir -p backup
sqlite3 "${DATABASE_PATH:-./data/anykpi.db}" \
  ".backup 'backup/anykpi-$(date -u +%Y%m%dT%H%M%SZ).db'"
```

Copying the file while the process is running can miss WAL pages. `.backup` is the snapshot procedure.

Restore by stopping the process and replacing the file:

```bash
# stop ANYKPI
cp backup/anykpi-YYYYMMDDTHHMMSSZ.db "${DATABASE_PATH:-./data/anykpi.db}"
# start ANYKPI
```

A snapshot includes encrypted source config. JSON/CSV export does not; after an export-only restore you reconnect sources and re-sync.

Docker: the named volume `anykpi-data` is `/data`. Snapshot that volume or run `.backup` against `/data/anykpi.db` inside the container.
