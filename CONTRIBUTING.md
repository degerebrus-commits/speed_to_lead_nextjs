# Contributing

Project-specific conventions. The broader engineering rules live in
`STANDARDS.md` (this folder) and `../STANDARDS.md` (all projects in this
workspace). Where this file is silent, those apply.

---

## What this system is

A lead-response and appointment-booking assistant **deployed once per service
business**, currently customized for HVAC companies.

It is **not** a SaaS. There is no `Organization` model, no `organizationId`
column, no tenant-scoped query layer, and no user/role system. One deployment
serves one company, and that company's data is the only data in the database.

> `STANDARDS.md` §13, §14, §15 and §57.3 describe a multi-tenant product with
> OWNER/ADMIN/STAFF roles. Those sections do not apply to this build. They
> should be amended to record the single-tenant decision — until they are, the
> contradiction will keep resurfacing.

---

## Nothing customer-facing is hardcoded

A new client deployment must require **configuration changes only**. If you
find yourself typing a business name, a phone country code, a port, or the
wording of a customer message into a `.ts` file, it belongs in configuration
instead.

The configuration surface is exactly two files:

| File | Holds |
|---|---|
| `.env` | All per-deployment values. Created from `.env.example`. Never committed. |
| `src/config/business.ts` | The typed accessor the application reads. |

`src/config/business.ts` is the seam. Adapting the product to another vertical
— plumbing, electrical, roofing — should not need a code change either.

### Message copy is a template, not a string literal

Customer-facing copy lives in `SMS_INTRO_TEMPLATE`, not in the SMS layer:

```
Hi {firstName}! Thanks for contacting {businessName}. I'm here to help. ...
```

`renderTemplate()` in `src/server/sms/sms-templates.ts` substitutes
`{placeholder}` tokens. Unknown placeholders are **left visible** rather than
blanked, so a configuration typo shows up in the output instead of shipping a
customer a sentence with a hole in it.

The shipped default matches the PRD wording exactly and is pinned by a test. A
client who wants different wording overrides the env var — they do not edit the
test.

---

## Stack

| Concern | Choice | Why |
|---|---|---|
| Framework | Next.js 15 (App Router) + TypeScript | One deployable per client. The admin dashboard and Google OAuth callback become routes in this app rather than a second service. |
| Database | PostgreSQL 16 via Docker | Dev and production must use the same engine. Idempotency depends on a real unique constraint. |
| ORM | Prisma | Migrations are Postgres-dialect; changing provider means a new baseline, never a reused migration. |
| Validation | Zod | One pattern at every external boundary. |
| Tests | Vitest | Runs against a real Postgres, not a mock. |

Keep dependencies minimal (§50). The rate limiter is deliberately ~30 lines of
in-process code rather than a package plus Redis — one deployment, one process.

---

## Getting started

```powershell
Copy-Item .env.example .env
```

Generate a real webhook secret and paste it into `.env`:

```powershell
node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"
```

Start the database. Only the database is containerized — the app runs on the
host, so source changes never trigger an image rebuild.

```powershell
docker compose up -d db
```

`docker compose up -d` exits 0 as soon as the container is *created*, which is
before Postgres accepts connections. Gate on the real thing:

```powershell
docker compose exec db pg_isready -U postgres
```

Then:

Windows PowerShell 5.1 has no `&&`, so these run as separate statements. And
because this folder's name contains `&`, npm/npx `.cmd` shims resolve a
truncated path — call the JS entrypoints through node instead:

```powershell
npm install
```

```powershell
node node_modules/prisma/build/index.js migrate dev
```

```powershell
node node_modules/next/dist/bin/next dev
```

### Port conflicts

`POSTGRES_PORT` exists because another project on this machine already binds
5432. If `docker compose up` reports `port is already allocated`, change
`POSTGRES_PORT` **and** the port inside `DATABASE_URL` — they must agree.

Never stop another project's container to free a port.

---

## Testing

```powershell
node node_modules/vitest/vitest.mjs run
```

Tests run against a **separate database**, derived from `DATABASE_URL` by
suffixing `_test`, created by `docker/initdb/01-create-test-database.sh` on
first startup. `tests/setup.ts` refuses to run if the resulting URL does not
name a `*_test` database — the suite truncates tables, and the seeded
development data is one connection string away.

`tests/setup.ts` deliberately sets a business name that appears nowhere in
`.env.example`. A test that passes with it proves the code read configuration
rather than a literal.

What to assert, per `../STANDARDS.md`:

- **Assert what reads the value, not that it saved.** Storing a field proves
  nothing if nothing consumes it. The spy-provider test exists because without
  it the SMS trigger could be wired to nothing and every other assertion would
  still pass.
- **Assert content, not status codes.** A 201 with an empty database is a
  passing test and a broken feature.
- **Test concurrency concurrently.** `Promise.allSettled` of two real
  simultaneous calls. Run sequentially, the duplicate test passes even when the
  guard is a `SELECT` both callers slip past.

---

## Idempotency

The lead intake endpoint is public and webhooks get retried. Duplicate
suppression is enforced by the **unique constraint on `Lead.dedupeKey`**, not by
a preceding `SELECT`.

A `SELECT` takes no lock. Two simultaneous deliveries would both read nothing,
both pass the check, and both insert — creating a second lead and texting the
customer twice. The condition goes inside the write; the `P2002` violation is
caught and the existing row returned.

Do not replace this with a find-then-create.

---

## Platform

Development happens on **Windows 10 / PowerShell 5.1**. Commands in this file
are PowerShell. Two traps worth knowing:

- **No `&&` or `||`** — chain with `;`, or `if ($?) { ... }` when the second
  step must not run after a failure.
- **This folder's name contains `&`**, which cmd.exe treats as a command
  separator, so `npm run dev`, `npm test` and `npx prisma ...` all fail with a
  path truncated at the ampersand. Invoke node directly, as above. Renaming the
  folder to drop the `&` fixes it permanently.

---

## Conventions

- **Filenames** are kebab-case: `lead-service.ts`, not `leadService.ts` (§5).
- **Functions** are verbs: `createLead()`, `sendIntroSms()`.
- **Booleans** carry a prefix: `isNew`, `hasAppointment`.
- **Comments explain why, not what** (§49). If a comment restates the code,
  delete it.
- **Errors** use the `{ error: { code, message } }` envelope from
  `src/lib/api-error.ts` (§9). Stack traces never cross that boundary.
- **Logs** never carry secrets or tokens. `src/lib/logger.ts` redacts keys
  matching `secret`, `token`, `password`, `apikey`, `authorization`,
  `credential` — but do not rely on it as a substitute for not logging them.

---

## Phase status

Phase 1 (lead capture and ingestion) is complete. Deliberately absent, in
dependency order:

1. **Real SMS provider** — `SmsProvider` is the interface Twilio slots into.
   `Lead.introSmsSentAt` being null is the work queue of leads still owed a
   first message.
2. **Inbound SMS webhook** — needs real signature verification, not the shared
   secret the first-party form uses.
3. **Conversation model** — carries the message and audit tables that §19 and
   §27 require in full.
4. **AI qualification** — the first real consumer of `serviceAddress` and
   `initialMessage`. Today those fields are stored but nothing reads them.
5. **Google Calendar booking.**
6. **Admin dashboard** — where §36-§38's loading, empty and error states apply.
