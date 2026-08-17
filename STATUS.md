# Project Status

Snapshot as of **2026-08-17**. Read this with `CONTRIBUTING.md` (conventions and
the single-tenant decision) and `STANDARDS.md` (engineering rules).

---

## Where things stand

| Phase | State |
|---|---|
| 1 — Foundation, lead capture | **Done**, verified end to end |
| 2 — Lead management UI | **Not started** — the app has no pages at all |
| 3 — SMS outbound | **Done**, verified with a real text on a real handset |
| 3 — SMS inbound | **Code done and verified over the public URL.** Real device capture blocked — see Blockers |
| 3 — Retry queue | **Done** — `POST /api/leads/retry-intro-sms` drains leads that never got a first message |
| 4 — AI qualification | **Done**, verified live on `claude-haiku-4-5` |
| 5 — Booking | **Not started** — config exists, nothing reads it |
| 6 — Analytics | **Not started** |
| 7 — Hardening | **Not started** |

**82 tests passing**, typecheck clean, production build succeeds.

---

## Verified, not assumed

- A website form POST creates a lead and triggers an intro SMS. Confirmed by reading the row back from Postgres, not from the API response.
- A real text arrived on the client's Redmi handset via TextBee. Copy matched the configured template byte for byte.
- The inbound webhook was driven over the public internet: unsigned → 401, signed → 200 and stored, replay → 200 with `duplicate: true` and no second row.
- A full qualification turn ran through Haiku: customer reply in, one qualifying question out, lead moved `NEW → ENGAGED`, both turns stored.

---

## Blockers

**The TextBee app on the Redmi does not capture incoming SMS.** Everything downstream is proven working — webhook URL, signature, storage, AI reply. The gap is the handset: `receivedSMSCount` never increments even for a text from a different number, while `sentSMSCount` does. Look at the app's SMS permissions and MIUI battery/autostart restrictions. This is a device problem, not a code problem — development is not blocked by it, because a signed POST is indistinguishable from a real delivery to every line of code past the signature check.

**The OpenAI account has no credit** (`insufficient_quota`). The key is valid. `AI_PROVIDER=openai` will fail until billing is added; `anthropic` works.

---

## Outstanding work, in priority order

1. **Phase 5 — booking.** Smaller than the PRD assumes: `BOOKING_MODE=fixed` with configured slots means **no Google Calendar is needed for MVP**. Offer slots → take a pick → write an `Appointment` row → send `SMS_BOOKING_CONFIRMATION_TEMPLATE`. Calendar becomes a later swap behind an interface, as with SMS and AI.
2. **Phases 2 + 6 together.** The lead list, conversation view, and metrics are one screen's worth of work. Doing 6 first would ship a dashboard whose booking-rate, appointment-volume, and completion-rate metrics are structurally zero.
3. **Amend `STANDARDS.md` §13/§14/§15/§57.3.** They mandate multi-tenancy and OWNER/ADMIN/STAFF roles, which this build deliberately does not have. Left untouched pending permission; until amended the contradiction resurfaces every session.

---

## Environment gotchas that will waste your time

**The folder name contains `&`.** cmd.exe treats it as a command separator, so every npm/npx `.cmd` shim resolves a truncated path and fails with an error naming a directory that does not exist. Call the JS entrypoints through node instead:

```powershell
node node_modules/next/dist/bin/next dev -p 3100
```

```powershell
node node_modules/vitest/vitest.mjs run
```

```powershell
node node_modules/prisma/build/index.js migrate dev
```

Renaming the folder to drop the `&` fixes this permanently.

**Postgres runs on port 5442**, not 5432 — another project on this machine already binds 5432. `POSTGRES_PORT` and the port inside `DATABASE_URL` must agree.

**Windows PowerShell 5.1 has no `&&`.** Chain with `;`.

**Restart the dev server after any `.env` edit.** Next reads `.env` once at boot, and `getEnv()` caches the parsed result for the process lifetime. Hot reload does not pick up either.

---

## Running it

```powershell
docker compose up -d db
```

```powershell
docker compose exec db pg_isready -U postgres
```

`docker compose up -d` exits 0 as soon as the container is *created*, which is before Postgres accepts connections — gate on `pg_isready`, not the exit code.

```powershell
node node_modules/next/dist/bin/next dev -p 3100
```

### Inbound webhook over the internet

Tailscale Funnel is currently **off**. The URL is stable across restarts, so the
TextBee webhook registration does not need re-pointing when you turn it back on:

```powershell
& "C:\Program Files\Tailscale\tailscale.exe" funnel --bg 3100
```

Endpoint: `https://desktop-vlqd8rl-1.tail586fe5.ts.net/api/webhooks/sms`

Turn it off when you stop testing — it exposes the whole dev server, not just
the webhook path:

```powershell
& "C:\Program Files\Tailscale\tailscale.exe" funnel --https=443 off
```

---

## Current configuration

| Setting | Value |
|---|---|
| `AI_PROVIDER` | `anthropic` → `claude-haiku-4-5` (blank `AI_MODEL` means provider default) |
| `SMS_PROVIDER` | `console` — logs instead of sending, costs nothing |
| Business hours | 08:00–18:00, Mon–Sat, `America/Chicago` |
| Real texts spent | **1 of 50** on the TextBee free tier |

Switching AI providers is one variable: `AI_PROVIDER=openai` uses `gpt-4o-mini`,
`anthropic` uses Haiku. Neither needs a model string.

**Tests never reach a paid API.** `getSmsProvider()` and `getAiProvider()` both
throw outright when `NODE_ENV=test`, and `tests/setup.ts` installs stub
providers by default. Running the suite is free.

---

## Design decisions worth not re-litigating

- **Single-tenant.** One deployment per business; no `Organization`, no `organizationId`, no roles. Per-client customization is `.env` only. See `CONTRIBUTING.md`.
- **Nothing customer-facing is hardcoded.** Business name, rep name, service area, hours, and every message template are configuration. `renderTemplate()` substitutes `{placeholder}` tokens and leaves unknown ones visible so a typo is obvious rather than silent.
- **Idempotency is a database constraint, not a `SELECT`.** `Lead.dedupeKey` and `Message.providerMessageId` are unique; the `P2002` violation is caught. Do not replace either with a find-then-create — two simultaneous deliveries would both read nothing and both insert.
- **Emergency detection runs in code, before the model.** A safety path that depends on a third-party API being healthy is not a safety path.
- **Failure isolation.** A lead is stored even when the SMS or AI call fails; the webhook still returns 2xx so the gateway stops retrying something already stored.
