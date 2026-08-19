# Project Status

Snapshot as of **2026-08-18**. Read with `CONTRIBUTING.md` (conventions and the
single-tenant decision), `PRD-TRACEABILITY.md` (every requirement, built or
not), `SPEC-COMPARISON.md` (how this differs from the Express build),
`MISTAKES.md` (what went wrong and the rules that prevent it), and
`STANDARDS.md`.

**218 tests passing**, typecheck clean, production build succeeds, CI runs on
every push.

---

## Where the code lives

| Repo | Contains |
|---|---|
| **`speed_to_lead_nextjs`** | This application. `main` is the only branch |
| `lead-to-speed-landingpage` | Landing page and the live demo form |
| `speed_to_lead_backend` | A parallel build by luislndch — Express + SQLite, with a 1192-line specification. Not superseded; see `SPEC-COMPARISON.md` |

The landing page was briefly duplicated here under `landing/` and drifted within
hours. It is gone; `DEMO-FORM-PROMPT.md` documents the `/api/demo/lead` contract
instead, so the link between the projects is a specification rather than a copy.

---

## Phases

| Phase | State |
|---|---|
| 1 — Foundation, lead capture | **Done**, verified end to end |
| 2 — Lead management UI | **Done** — list, filters, paging, conversation view |
| 3 — SMS out / in / retry | **Done**, verified with a real text on a real handset |
| 4 — AI qualification | **Done**, verified live on `claude-haiku-4-5` |
| 5 — Booking | **Done** — fixed slots, no calendar needed for MVP |
| 6 — Analytics | **Done** — speed to lead, booking rate, after-hours split |
| 7 — Hardening | **Mostly done** — auth, consent, HELP, owner alerts, and every finding from the security review |

---

## Verified, not assumed

- A website form POST creates a lead and triggers an intro SMS, confirmed by reading the row back from Postgres rather than trusting the API response.
- A real text arrived on the client's Redmi handset via TextBee, copy matching the template byte for byte.
- The inbound webhook driven over the public internet: unsigned → 401, signed → 200 and stored, replay → `duplicate: true` with no second row.
- A full qualification turn through Haiku: reply in, question out, lead `NEW → ENGAGED`, both turns stored.
- Double-booking prevented by the unique constraint on `Appointment.slotKey` — the `P2002` appears in the test output, so the race is genuinely exercised.
- The dashboard refuses unauthenticated access: `/` and `/leads` redirect, a forged cookie yields a redirect payload containing no customer data, a correctly signed cookie renders.
- **A fresh clone runs.** Cloned into an empty folder, `npm ci`, `prisma generate`, `migrate deploy`, suite green with a `.env` containing only a database URL and dummy keys.

---

## Blockers, none of them code

**A2P 10DLC registration has not started.** Until it is approved the system can
only text our own handset, not real customers. One to two weeks, and it will
not pass without the consent line live on the client's form. This is the
critical path to going live — see `CLIENT-REQUIREMENTS.md`, which is written
for the client to read directly.

**TextBee delivers, but late - and inbound is never captured.**

Corrected 2026-08-19. Yesterday this file said three messages dispatched at
11:56 never arrived; they did arrive, substantially delayed. The distinction
matters: the gateway is not broken, it is slow, and the likely cause is MIUI
battery optimisation deferring the app's background work so messages queue on
the handset and flush when Android next lets it run. Untested fix: Settings ->
Apps -> TextBee -> Battery saver -> No restrictions, plus Autostart.

**Latency is the open question and it decides the gateway.** The product's
whole promise is a reply within seconds. Seconds is fine; ten minutes makes a
live demo unwinnable. Nobody has measured it yet - send one message, timestamp
it, and time the arrival before choosing.

**Inbound was never captured at all** - `receivedSMSCount` never increments,
even for a text from a different number. That part is unambiguous.

Neither is a code problem: every line past the signature check cannot tell a
signed POST from a real delivery, and the full booking flow was proven that way
on 2026-08-18 - lead captured with consent, slots offered, `Mon-Fri 2pm` booked,
appointment stored, dashboard updated.

**SMS Gate (capcom6/android-sms-gateway) is built and ready as an alternative**
but has never sent a message. It reports real per-message delivery state, which
is what would have answered the question above in seconds rather than a day.
Same category as TextBee though - a handset relay, so it cannot be A2P
registered either.

Keep `SMS_PROVIDER=console` until a gateway is chosen; it logs instead of
sending and costs nothing.

**The OpenAI account has no credit.** `AI_PROVIDER=openai` fails with
`insufficient_quota`; `anthropic` works.

---

## Outstanding, in priority order

1. **Structured qualification.** Urgency, property type and preferred time are
   discussed with the customer and then left in message text, unqueryable. The
   other build's `record_qualification` tool idea closes this - the model
   extracts, the code still executes. Do not give it `book_appointment`.
2. **An upcoming-appointments view.** Appointments now carry `scheduledAt`, so
   "what is on tomorrow" is finally answerable and nothing displays it.
3. **Google Calendar.** The largest PRD divergence, and genuinely optional
   while fixed slots serve the MVP. Needs the timestamps that now exist.
4. **`STANDARDS.md` §13/§14/§15/§57.3.** They mandate multi-tenancy and
   OWNER/ADMIN/STAFF roles, which this build deliberately does not have. Still
   untouched pending permission; the contradiction resurfaces every session.

**Deployment: the image builds and starts, but was not proven stable locally.**
`DEPLOYMENT.md`, a three-stage Dockerfile on Next's standalone output, an
entrypoint applying migrations before serving, and `GET /api/health`.

What was verified on 2026-08-18: the image builds (954 MB), the container
starts, `migrate deploy` runs, the server is ready in ~2s, `/login` returns 200
and `POST /api/leads/webhook` correctly returns 401 without a secret. Prisma
queries succeed when run by hand inside the container, and the query engine and
health route are both present in the image.

**Then it wedges.** Within a few minutes every route returns nothing - no
response, no log line, and `docker exec` into the container hangs as well. The
container still reports `Up`, using 64 MB and 0% CPU. Not diagnosed.

Docker Desktop's VM has **941 MB total** for all containers, on a host with
~1.8 GB free and a gigabyte paged out, and it is already running two Postgres
containers. That is the obvious suspect and matches every other resource
problem on this machine today, but it is a suspicion, not a finding.

**Do not treat the container as working until it has been run somewhere with
real memory.** Railway is the natural place to find out - and if it wedges
there too, this is a genuine defect rather than the machine.

### Done since this file was last written

`scheduledAt` on appointments - which uncovered that the schedule exhausted
permanently after six bookings, because the slot key ignored dates. Cancel and
reschedule, so a mis-booked slot can be released. And all three remaining
security findings: the rate-limit key is bounded and no longer trusts a
caller-supplied header, the retry endpoint is limited, and the logger recurses
and scrubs secret *values* rather than only key names.

---

## Known issues

**The suite is occasionally flaky on this machine** - roughly one run in five,
always in the heaviest specs.

Diagnosed 2026-08-18. It was never a vitest timeout: failures landed
consistently at 5.1-5.3s, which is **Prisma's connection-pool timeout**, and
`getDashboardMetrics` issues five queries in one `Promise.all` while the whole
suite shares a single fork. Postgres was idle throughout - zero lock waits,
zero idle-in-transaction sessions, 11 of 100 connections, 0% container CPU.

`tests/setup.ts` now sets `connection_limit=25` and `pool_timeout=20` on the
test database URL, which took it from failing two runs in three to one in five.
The remainder is this machine: ~1.8 GB of 6.9 GB free with a gigabyte paged
out, and Defender scanning `node_modules`.

Two changes made while diagnosing are kept on their own merits but were not the
cause: the 20s test timeout, and `tests/setup.ts` no longer disconnecting Prisma
after every file.

**CI is the honest signal: eight runs, eight green**, including three pushed
while local runs were failing. A red local run against a green CI means the
machine - close Chrome, or exclude this folder from Defender. Chase the code
only when CI itself goes red.

**`Firstline-Landing-Package.html` is untracked at the repo root. Do not push
it to the landing repo.** It is a *stale* export: unpacking its gzipped base64
shows the pre-fix calculator disclaimer, so pushing it would silently revert
0282f48 with a diff that looks like nothing but regenerated UUIDs. Re-export
from Claude Design if a fresh bundle is wanted; otherwise delete it.

**An unknown lead id returns HTTP 200** rather than 404, while correctly
rendering the "Lead not found" page. Removing the loading boundary did not
change it, so the streamed-status theory is wrong and the cause is unidentified.
Cosmetic — no data leaks.

---

## Environment gotchas that will waste your time

**The folder name contains `&`.** cmd.exe treats it as a command separator, so
every npm/npx `.cmd` shim resolves a truncated path. Call the JS entrypoints
through node instead:

```powershell
node node_modules/next/dist/bin/next dev -p 3100
```

```powershell
node node_modules/vitest/vitest.mjs run
```

```powershell
node node_modules/prisma/build/index.js migrate dev
```

A fresh clone into a folder without the `&` does not have this problem — `npm ci`
and `npm test` work normally there. Renaming this folder fixes it permanently.

**Postgres runs on port 5442**, not 5432 — another project already binds 5432.
`POSTGRES_PORT` and the port inside `DATABASE_URL` must agree.

**Windows PowerShell 5.1 has no `&&`.** Chain with `;`.

**Restart the dev server after any `.env` edit.** Next reads `.env` once at boot
and `getEnv()` caches it for the process lifetime.

**Never run `next build` while the dev server is running.** The production build
overwrites `.next` underneath it and every route starts returning 500. Stop the
server, delete `.next`, restart.

---

## Running it

```powershell
docker compose up -d db
```

```powershell
docker compose exec db pg_isready -U postgres
```

`docker compose up -d` exits 0 as soon as the container is *created*, which is
before Postgres accepts connections — gate on `pg_isready`, not the exit code.

```powershell
node node_modules/next/dist/bin/next dev -p 3100
```

The dashboard is at `/` and requires `DASHBOARD_PASSWORD` from `.env`. Unset
means it serves nothing at all rather than serving openly.

### Inbound webhook over the internet

Tailscale Funnel is currently **off**. The URL is stable across restarts:

```powershell
& "C:\Program Files\Tailscale\tailscale.exe" funnel --bg 3100
```

Endpoint: `https://desktop-vlqd8rl-1.tail586fe5.ts.net/api/webhooks/sms`

Turn it off when you stop testing — it exposes the whole dev server:

```powershell
& "C:\Program Files\Tailscale\tailscale.exe" funnel --https=443 off
```

---

## Current configuration

| Setting | Value |
|---|---|
| `AI_PROVIDER` | `anthropic` → `claude-haiku-4-5` |
| `SMS_PROVIDER` | `console` — logs instead of sending, costs nothing |
| Business hours | 08:00–18:00, Mon–Sat, `America/Chicago` |
| Real texts spent | **1 of 50** on the TextBee free tier |
| `DEMO_FORM_ENABLED` | `true` locally — **turn off before deploying** |

**Tests never reach a paid API.** `getSmsProvider()` and `getAiProvider()` both
throw when `NODE_ENV=test`, and `tests/setup.ts` installs stubs. Running the
suite is free.

---

## Design decisions worth not re-litigating

- **Single-tenant.** One deployment per business; no `Organization`, no roles. Per-client customization is `.env` only.
- **Not a monorepo.** One Next.js application serving both pages and API routes from a single process, so pages import server functions directly and the types stay honest end to end.
- **Nothing customer-facing is hardcoded.** `renderTemplate()` leaves unknown placeholders visible so a typo is obvious rather than silent.
- **Idempotency is a database constraint, not a `SELECT`.** `Lead.dedupeKey` and `Message.providerMessageId` are unique and the `P2002` is caught. Do not replace either with find-then-create.
- **Emergency detection runs in code, before the model.** A safety path that depends on a third-party API being healthy is not a safety path.
- **Consent gates sending, not storing.** A lead without a consent tick is saved and flagged on the dashboard; the text is held. Losing a customer over a missing checkbox would be worse than not texting them.
- **A digit only counts as a slot choice after slots were offered.** Reading every number as a selection booked appointments for customers describing their problem.
- **Failure isolation.** A lead is stored even when the SMS or AI call fails, and the webhook still returns 2xx so the gateway stops retrying something already stored.
