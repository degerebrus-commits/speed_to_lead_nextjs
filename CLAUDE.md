# Project Constraints & Guardrails

## Critical Action Checklist

Before executing any of these, pause and think through consequences:

- Deleting or modifying existing data (leads, appointments, calendar events)
- Writing to external systems (Google Calendar, SMS providers, customer-facing APIs)
- Changing authentication or permission logic
- Committing code that changes customer-visible behavior
- Rotating secrets or credentials

For each one:

1. **State what you're about to do** — exact operation, not a summary
2. **Explain why** — the business reason or the problem it solves
3. **Ask before proceeding** — even if the code is obviously correct

Never assume. Never infer. Never optimize around the question.

## Secret Handling

- Never print raw API responses, even partially. Select fields by name before displaying.
- Never log or echo credentials, tokens, or signing secrets.
- Rotate credentials immediately if leaked, and document in MISTAKES.md.
- Use `<redacted>`, `<set>`, or `<not printed>` when referring to sensitive values in output.

## Debugging Before Building

When something is unexplained (a message from an unknown source, unexpected state, an ambiguous error):

- Ask first. Infer second.
- Human action is the first hypothesis; rule it out by asking before concluding a second system exists.
- Typos and inconsistencies are tells of human authorship.

## Testing Against Real Systems

When a test uses real external systems (Google Calendar, SMS gateways):

- Document why the test isolation exists
- Verify isolation with an explicit assertion (confirm the real system was NOT reached)
- Record any found gaps in MISTAKES.md with the prevention rule

## Out of scope: the client's paperwork

A2P 10DLC registration and the SMS provider account belong to whichever client
the deployment is sold to, filed under their business. They are not project
tasks, not blockers on this codebase, and do not belong in status reports,
outstanding lists, or "what's next" summaries.

Mention them only when asked directly, or when a code decision genuinely turns
on one.
