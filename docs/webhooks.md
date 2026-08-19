# Realtime webhook-in

Push events into the same read models the pull connectors write. The path is
`POST /api/ingest/webhook/:source`. Auth is a per-source HMAC secret stored
encrypted at rest (`POST /api/v1/connect`). Re-submitting the secret rotates it
and invalidates the previous value immediately.

Live writes stay keyed: the HMAC is the credential. There is no unsigned
ingest path.

## Store the HMAC

Pick a source slug that matches the URL (`posthog`, `zapier`, or another
`[a-z][a-z0-9_-]*` slug). Writes to `/api/v1/connect` require an API key.

```bash
curl -X POST http://localhost:3000/api/v1/connect \
  -H "Authorization: Bearer $ANYKPI_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "source": "posthog",
    "workspaceId": "live",
    "credentials": { "hmacSecret": "replace-with-a-long-random-secret" }
  }'
```

`anykpi connect <source> --secret-key <hmac>` stores the same field (`secretKey`
is accepted as an alias for `hmacSecret`).

If that source already has pull credentials, include them in the same
payload so the row is not replaced with only the HMAC.

## Sign every request

HMAC-SHA256 over the **exact raw JSON body**, hex digest. Send one of:

- `X-Webhook-Signature: sha256=<hex>`
- `X-Hub-Signature-256: sha256=<hex>`
- the bare 64-character hex digest in either header

Query `?workspace=` selects the sources row (default `live`).

```bash
BODY='{"userId":"u1","eventName":"song_played"}'
SIG=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$HMAC_SECRET" | awk '{print $2}')

curl -X POST "http://localhost:3000/api/ingest/webhook/posthog?workspace=live" \
  -H "Content-Type: application/json" \
  -H "X-Webhook-Signature: sha256=$SIG" \
  -d "$BODY"
```

A bad or missing signature returns **401**. A valid signature and a recognized
event shape returns `{ "success": true, "accepted": N }`.

Accepted event fields (first match wins):

| Field | Aliases |
| --- | --- |
| user id | `userId`, `distinct_id`, `person.distinct_id` |
| event name | `eventName`, `event` (string), `event.event` |
| properties | `properties` |
| timestamp | `timestamp` (ISO-8601) |

## Recipe: PostHog destinations

Use the committed fixture at [`docs/recipes/posthog-destination.json`](recipes/posthog-destination.json).
The unit test signs that file and asserts the event lands.

1. Store an HMAC for source `posthog` (see above). If PostHog is already
   connected for pull, re-submit `apiKey` / `projectId` / `host` together
   with `hmacSecret`.
2. Destination URL:
   `https://<your-host>/api/ingest/webhook/posthog?workspace=live`
3. Body template (matches the fixture):

   ```json
   {
     "event": "{event.event}",
     "distinct_id": "{event.distinct_id}",
     "timestamp": "{event.timestamp}",
     "properties": {event.properties}
   }
   ```

4. Add header `X-Webhook-Signature` set to HMAC-SHA256 of the exact request
   body (hex, optionally prefixed with `sha256=`). Customize the destination
   source to compute that digest with the same secret you stored.

## Recipe: Zapier

Use the committed fixture at [`docs/recipes/zapier.json`](recipes/zapier.json).

1. Store an HMAC for source `zapier`:

   ```bash
   curl -X POST http://localhost:3000/api/v1/connect \
     -H "Authorization: Bearer $ANYKPI_API_KEY" \
     -H "Content-Type: application/json" \
     -d '{
       "source": "zapier",
       "workspaceId": "live",
       "credentials": { "hmacSecret": "replace-with-a-long-random-secret" }
     }'
   ```

2. Webhook URL:
   `https://<your-host>/api/ingest/webhook/zapier?workspace=live`
3. POST JSON with `userId`, `eventName`, and optional `properties` /
   `timestamp` (same shape as the fixture).
4. Compute HMAC-SHA256 of the raw body in a Code step and set
   `X-Webhook-Signature` to `sha256=<hex>` on the request.

Do not put the secret in the URL. Query strings are logged.
