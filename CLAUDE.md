# CLAUDE.md — Project Constitution

## Tech Stack & Architecture
- Next.js 15, App Router only. Ignore Pages Router paradigms entirely.
- React Server Components by default. Exactly one `'use client'` file exists; add more only for real hook usage.
- Strict TypeScript. No `any`.
- **Styling is one hand-written stylesheet — `src/app/globals.css`. There is no Tailwind and no CSS framework, deliberately.** Use the CSS variables defined at its top; they carry dark mode.
- Prisma + Postgres in Docker. npm, not pnpm or yarn.
- Single-tenant: one deployment per client. See PROJECT.md 25.

## Build & Validation Commands
- Dev server: `npm run dev` (port 3100)
- Tests: `npm test`
- Production build: `npm run build`
- Typecheck: `npx tsc --noEmit` — **there is no `lint` script; do not invent one**
- Migrations: `npm run db:migrate`

## Anti-Hallucination & Execution Rules
- NEVER guess syntax, API endpoints, library imports, or file paths.
- If a method or version is ambiguous, emit `// VERIFY_SYNTAX` and ask.
- Check the file tree before writing an import. Do not create a second file that already exists.
- Do not build multi-file workarounds around a missing dependency. Say it is missing.
- Wrap Route Handlers and Server Actions in try/catch returning the JSON error envelope.
- Claims about the codebase are read from the codebase, not recalled.

## Definition of Done
- Tests were run and the output is in the reply. "Should work" is not done — say which happened.
- **Gate on exit codes, never a filtered pipeline.** `tsc | head` then `echo clean` prints "clean" over a failing compiler.
- New behaviour has a test confirmed to fail against the unfixed code.
- Typecheck clean.

## Never
- Never print raw API responses or log lines that may carry secrets. Select fields by name.
- Never commit `.env` or `.env.backup*`.
- Never `2>/dev/null` on anything whose failure you would act on.
- Never let a model decide whether an appointment happened. Code executes; the model talks.

## Ask First
- Deleting or modifying leads, appointments, or calendar events.
- Writing to Google Calendar, sending SMS, anything a customer sees.
- Schema changes, auth changes, rotating secrets.
- Anything over about an hour: propose the plan and wait. Correcting a plan costs a paragraph.

## Debugging
- Ask before inferring. "A person did it" is the first hypothesis, not "a second system exists".
- Read the exception before forming a theory.
- A test passing alone and failing in the suite is isolation, not the new feature.
- A recurring symptom is an unexamined cause, not flakiness.

## Environment Traps
- Start Docker Desktop first. It does not survive a reboot here.
- `docker compose up -d` returns before Postgres accepts connections. Gate on `pg_isready`.
- Tests use a separate `_test` database. Apply migrations to both.
- `prisma migrate` fails with EPERM while the dev server holds the query engine. Stop it first.

## Conventions
- Per-client config: `src/config/business.ts`. Nothing customer-facing is hardcoded elsewhere.
- Keep new components small; split past ~250 lines. Existing service and config files exceed this and are not a precedent.
- Read `STATUS.md` and `MISTAKES.md` at session start.
- Record every new bug class in `MISTAKES.md` with the rule that prevents it — after the bug, not at session end.
- A2P registration and SMS provider accounts belong to the client. Not project status.
