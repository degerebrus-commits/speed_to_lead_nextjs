# CLAUDE.md

## Stack
- Use npm, not pnpm or yarn.
- TypeScript strict mode. No `any`.
- Next 15 App Router, Prisma, Postgres in Docker. One stylesheet, no framework.
- Single-tenant: one deployment per client. See PROJECT.md 25.

## Definition of done
- Tests run and the output is in the reply (`npm test`). "Should work" is not done.
- Typecheck clean — gate on the exit code, never a filtered pipeline. `tsc | head` then `echo clean` lies.
- New behaviour has a test that was confirmed to fail against the unfixed code.
- No new lint warnings.

## Never
- Never print raw API responses or log lines that may carry secrets. Select fields by name.
- Never commit `.env` or `.env.backup*`.
- Never `2>/dev/null` on anything whose failure you would act on.
- Never let a model decide whether an appointment happened. Code executes; the model talks.

## Ask first
- Deleting or modifying leads, appointments, or calendar events.
- Writing to Google Calendar, sending SMS, or anything a customer sees.
- Schema changes, auth changes, rotating secrets.
- Anything over about an hour: propose the plan, wait for yes. Correcting a plan costs a paragraph.

## Debugging
- Ask before inferring. A person did it is the first hypothesis, not a second system.
- Read the exception before forming a theory.
- A test that passes alone and fails in the suite is isolation, not the new feature.
- A recurring symptom is an unexamined cause, not flakiness.

## Environment traps
- Start Docker Desktop first. It does not survive a reboot here.
- `docker compose up -d` returns before Postgres accepts connections. Gate on `pg_isready`.
- Tests use a separate `_test` database. Apply migrations to both.
- `prisma migrate` fails with EPERM while the dev server holds the query engine. Stop it first.

## Conventions
- Per-client config: `src/config/business.ts`. Nothing customer-facing is hardcoded elsewhere.
- Read `STATUS.md` and `MISTAKES.md` at session start.
- Record every new bug class in `MISTAKES.md` with the rule that prevents it.
- A2P registration and SMS provider accounts belong to the client. Not project status.
