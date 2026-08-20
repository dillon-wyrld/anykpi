# External cron

ANYKPI pulls connected sources in-process every 15 minutes by default
(`SYNC_INTERVAL_MINUTES`). Set the interval to `0` when the host already
has a scheduler, or when the process may sleep between requests — an
in-process timer cannot keep data fresh if the server is not running.

```bash
# Disable the in-process timer
SYNC_INTERVAL_MINUTES=0
```

Trigger the same path a human or agent uses for "sync now":
`POST /api/v1/sync`. Writes require an API key. Omit `source` to refresh
every registered connector; pass one source to refresh only that pull.

```bash
# Every 15 minutes — one workspace
*/15 * * * * curl -sS -X POST "$ANYKPI_URL/api/v1/sync" \
  -H "Authorization: Bearer $ANYKPI_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"workspace":"live"}'
```

One source:

```bash
curl -sS -X POST "$ANYKPI_URL/api/v1/sync" \
  -H "Authorization: Bearer $ANYKPI_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"workspace":"live","source":"ics"}'
```

The request shares the in-process coalesce lock with any overlapping
run, so a cron tick that lands on a still-running pass does not
double-pull.

A nightly full reconcile is built into the in-process scheduler (first
tick of each UTC day). External cron hosts that need the same pass can
run the same `POST` more often; incremental sources resume from their
stored cursor, and a later in-process boot still does a full pass.
