# Deployment

One deployment per client. This document assumes Railway, which is what
`Checklist.md` specifies, but nothing here is Railway-specific beyond the
console clicks — the image runs anywhere that can run a container and reach
Postgres.

---

## What ships

A single container. The application serves both the dashboard pages and the API
routes from one Next.js process, so there is **one service to deploy**, not a
frontend and a backend. The database is the only separate piece.

The image is built in three stages and the final one carries only
`.next/standalone` — the server plus the modules it actually imports — the
Prisma CLI and schema, and nothing else. No tests, no documentation, no
devDependencies, and no `.env`.

---

## Before the first deploy

1. **A Postgres database.** Railway provisions one and sets `DATABASE_URL` for
   you. Any Postgres 16 works.
2. **The environment variables below.** The application refuses to start
   without the mandatory ones, deliberately: a misconfigured deployment should
   fail loudly rather than accept leads it cannot store or text.
3. **A2P 10DLC registration.** Not a deployment step, but nothing can text a
   real customer until it is approved. See `CLIENT-REQUIREMENTS.md`.

---

## Environment variables

### Mandatory — the app will not start without these

| Variable | Notes |
|---|---|
| `DATABASE_URL` | Set by Railway when you attach a Postgres service |
| `LEAD_WEBHOOK_SECRET` | 16+ chars. `openssl rand -hex 24` |
| `BUSINESS_NAME` | Exactly as it should read in texts |
| `BUSINESS_COUNTRY_CODE` | e.g. `+1` |
| `ANTHROPIC_API_KEY` *or* `OPENAI_API_KEY` | Whichever `AI_PROVIDER` names |

### Set these too, or the deployment misbehaves quietly

| Variable | Why it matters |
|---|---|
| `DASHBOARD_PASSWORD` | **Unset means the dashboard serves nothing.** That is the safe default, not a bug — the alternative is publishing customer home addresses |
| `TRUSTED_PROXY="true"` | Railway terminates TLS and writes `X-Forwarded-For`. Left `false`, every caller shares one rate-limit bucket |
| `BUSINESS_TIMEZONE` | Appointment times are resolved against this. Wrong value books the right hour on the wrong clock |
| `SMS_PROVIDER` | Stays `console` until the client's gateway is live. `console` logs instead of sending, and costs nothing |
| `DEMO_FORM_ENABLED="false"` | The demo form texts whatever number is typed into it. Off unless you mean it |

Everything else has a working default — `tests/config/defaults.test.ts` asserts
the schema validates with only the mandatory five set.

`.env.example` documents every key, and a test fails if it drifts from
`src/config/env.ts`.

---

## Railway

1. **New Project → Deploy from GitHub repo** → `speed_to_lead_nextjs`.
2. **Add a Postgres service.** Railway sets `DATABASE_URL` on the app service
   automatically once they are linked.
3. **Variables** → paste the values above.
4. Railway detects the `Dockerfile` and builds it. No build command or start
   command needs configuring — the image has an entrypoint.
5. **Generate a domain** under Settings → Networking.

### Migrations

`docker/entrypoint.sh` runs `prisma migrate deploy` before the server starts.
`deploy` applies committed migrations and never generates one, so production
runs exactly the schema that was reviewed. If a migration fails the container
exits rather than serving an application whose schema disagrees with its code.

### Health checks

`GET /api/health` queries the database and returns 503 when it cannot. Point
Railway's health check at it — an instance that cannot reach Postgres can serve
no page and store no lead, and should not be receiving traffic.

The image also declares a `HEALTHCHECK`, so `docker ps` reports the same thing
locally.

---

## After deploying

**Point the lead form at the deployment.** The client's website posts to
`POST /api/leads/webhook` with the `x-webhook-secret` header. That secret lives
server-side on their site — never in browser JavaScript, or the endpoint is
effectively public and anyone can spend the SMS allowance.

**Point the SMS gateway's webhook** at `POST /api/webhooks/sms`. It is verified
by HMAC over the raw body, so the signing secret must match
`TEXTBEE_WEBHOOK_SECRET`.

**Sign in to the dashboard** at `/` and confirm the metrics render.

**Send one real lead through the form** and check it appears with a consent
timestamp. A lead arriving without one is stored and flagged rather than
texted — that is correct behaviour, and it means the form is not sending the
consent field.

---

## Running the image locally

```powershell
docker build -t hvac-assistant .
```

```powershell
docker run --rm -p 3000:3000 --env-file .env hvac-assistant
```

`--env-file` rather than baking values in: secrets in a layer survive in the
image history, and `.dockerignore` excludes `.env` for the same reason.

On this machine the build takes several minutes — it is memory-bound, not
CPU-bound. CI builds the same image in about a minute.

---

## What is not automated

**Rollback.** Railway keeps previous deployments and can redeploy one, but a
migration is not reversed by redeploying older code. Additive migrations are
safe; a destructive one needs a considered plan before it ships.

**Backups.** Railway's Postgres has its own backup settings. Nothing in this
repository configures them, and the lead table is the business's customer list.

**Secrets rotation.** Changing `LEAD_WEBHOOK_SECRET` requires updating the
client's website at the same time, or lead intake starts returning 401.
