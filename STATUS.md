# Project Status

Snapshot as of **2026-08-19**. Read with `CONTRIBUTING.md` (conventions and the
single-tenant decision), `PRD-TRACEABILITY.md` (every requirement, built or
not), `SPEC-COMPARISON.md` (how this differs from the Express build),
`MISTAKES.md` (what went wrong and the rules that prevent it), and
`STANDARDS.md`.

**251 tests passing**, typecheck clean, production build succeeds, CI runs on
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

**The handset gateways do not work. Use Twilio.**

Settled 2026-08-19 after two clean tests. TextBee accepts a message, returns a
real provider id in about two seconds, and the phone never delivers it -
yesterday three messages arrived hours late, today one never arrived at all.
Inbound works. It always did - this code was rejecting it.

That is not a code problem. Every line past the signature check cannot tell a
signed POST from a real delivery, and the full booking flow was proven that way:
lead captured with consent, slots offered, a slot booked, appointment stored,
dashboard updated.

**Neither handset relay can ever go live regardless.** A personal SIM cannot be
registered for A2P 10DLC, and US carriers filter unregistered automated
business traffic. TextBee and SMS Gate were only ever development tools.

**A likely cause of the outbound delay, found 2026-08-19 and not yet tested.**
The TextBee device record reads `heartbeatIntervalMinutes: 30`, and observed
delays have been 23-35 minutes. TextBee pushes a send request to the handset
over FCM; if the push does not wake the app, the message waits until the app
next wakes on its own - up to the heartbeat. The handset is a Redmi running
MIUI, whose battery manager suppresses background wakeups aggressively.

That matches the whole distribution, and it explains the asymmetry: inbound is
instant because the phone is already awake when it receives a text.

Worth ten minutes before writing TextBee off: set the app to *No restrictions*,
enable Autostart, lock it in Recents, and drop the heartbeat interval. If a
message then lands in seconds, the gateway is demo-viable - though still never
launch-viable, for the A2P reason above.

**Another application is sending through the same TextBee account.** A
confirmation nobody here wrote ("Ok you are booked Aug 20, 22026 2PM") appears
in TextBee's Sent log and in no row of our database. There is exactly one
webhook subscription and it is ours, so the other app receives nothing - but
sending needs only the API key. Any SMS test is polluted until that is
resolved. Rotate `TEXTBEE_API_KEY` to cut it off.

**The Twilio provider is built and tested** - outbound through the REST API, and
an inbound webhook verified against X-Twilio-Signature, which signs the request
URL as well as the parameters. It needs an account: TWILIO_ACCOUNT_SID,
TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER and TWILIO_WEBHOOK_URL. A trial account
is enough to demo - it only delivers to numbers verified in the console and
prefixes a trial notice, both of which disappear on upgrade.

Keep SMS_PROVIDER=console until those credentials exist.

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

### Done on 2026-08-19

- **Google Calendar, connected and proven.** A service-account JWT minted with
  node:crypto rather than the googleapis SDK - thirty lines against tens of
  megabytes for two endpoints. Confirmed appointments are written to the
  business's calendar, and the calendar is read back to filter availability, so
  "open" now means the business is genuinely free rather than merely not booked
  by us. Every calendar failure is swallowed and logged: the appointment is
  already committed and the customer already told, so a Google outage must not
  turn a successful booking into a failed one. `calendarEventId` stays null on
  failure and is the backfill queue.

  Verified end to end at 08:32Z: lead intake, three options offered, "1"
  booked, event on the calendar at the right instant in Asia/Manila with the
  address in `location` and the customer's own words in the description.

- **Three options at a time, and a second set on request.** The agent offers
  `SLOT_OFFER_COUNT` (default 3) dated options, soonest first. A customer who
  replies "none of those work" gets a genuinely different three; when the
  three-week horizon is exhausted, it hands off to a person rather than
  apologising in a loop. Matches the 3-5 range the published guidance
  recommends, and the "offer times near what they wanted" pattern.

  Two columns had to be persisted for this to be safe. `offeredSlotKeys` is the
  numbered list as shown - recomputing availability when "2" arrives yields a
  different list if anything was booked in between, and every number below the
  change shifts, booking the customer into a time they did not pick.
  `declinedSlotKeys` is what they have turned down, so a later set is actually
  different.

  Slots are now dated ("Thu Aug 20, 9am") because one configured label resolves
  to many real occurrences, and a second set is meaningless without the date.
  `bookSlot` takes the chosen occurrence rather than the label: it used to
  re-resolve to the *next* occurrence, which would have booked someone who
  turned down everything sooner into this week regardless.

- **Twilio provider and signed inbound webhook.** The only gateway that can
  carry a real deployment. Needs an account before it can be tested.
- **National trunk prefixes.** "0953 430 5571" is how a Filipino writes their
  mobile; the normaliser prepended +63 without dropping the zero, producing a
  13-digit number that does not exist, and nothing reported it as wrong.
  Invisible while +1 was the only configured country, because the US has no
  trunk prefix. It also broke deduplication: the same customer entering
  "0953..." and "953..." became two leads.
- **Echo guard.** A handset registered as the gateway reports its own outbound
  texts as received, so the assistant answered itself. An inbound message
  matching something sent to that number within ten minutes is stored but never
  answered, and cannot opt anyone out - the booking confirmation ends "Reply
  STOP to opt out", which classified as a keyword would unsubscribe the
  customer from their own confirmation.
- **Empty optional config.** .env.example ships optional keys as KEY="", and
  dotenv hands those through as empty strings, so .url() and .min(1) rejected
  them exactly as a wrong value. Anyone copying the example verbatim could not
  start the app. A test now reads the real .env.example and asserts it starts.
- **Philippines configuration** for testing: +63, Asia/Manila, Metro Manila
  service area. Previous US settings saved to .env.backup-before-ph.

**The demo form has three real bugs**, recorded in DEMO-FORM-PROMPT.md for the
next regeneration: the consent control needs two clicks to register, gives no
visible state change when it does, and a failed submit leaves its error on
screen until refresh. All three read to the user as "the submit button is
broken".

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
