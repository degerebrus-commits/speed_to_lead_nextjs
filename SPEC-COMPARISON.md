# Our build vs. `speed_to_lead_backend/SPECIFICATION.md`

Comparison of this Next.js implementation against the Express/SQLite backend
specification on `speed_to_lead_backend@master`, written by luislndch last
month. Read alongside `PRD-TRACEABILITY.md`.

**Both implement the same product from the same PRD.** Neither is a superset of
the other. This document exists so the choice between them is made on evidence
rather than on which one is newer.

---

## The one real architectural disagreement

**The spec has Claude call tools. Ours decides in code.**

The spec defines two tools the model invokes — `book_appointment` (with
`customer_name`, `customer_phone`, `address`, `issue`, `slot`, and an `urgency`
enum) and `flag_emergency`. The model gathers the information and hands it over
as typed arguments.

Ours runs emergency detection and slot matching in application code *before*
the model sees anything. The model only converses.

`Checklist.md` line 72 asked for the spec's approach explicitly: *"using tool
use / function calling so the model can trigger a real booking or a real
emergency alert rather than us parsing its text."*

### The case for ours

A safety path that depends on a third-party API being reachable is not a safety
path. Emergency detection works with the AI provider down, and a test asserts
exactly that. Booking cannot be hallucinated: a customer is never told they are
booked unless a row exists.

### The case for theirs — which today made stronger

Our approach parses the *customer's* text, and this morning's security review
found that any 1–2 digit number in any reply booked an appointment. "It's been
broken for 3 days" booked slot 3 and texted a confirmation. Fixed, but the
class of bug is inherent to guessing intent from free text.

**More importantly, tool-use solves a gap our build has and cannot easily
close.** `PRD-TRACEABILITY.md` records that qualification is never extracted
into data — urgency, property type and preferred time are discussed and left in
message text, unqueryable. The spec's `book_appointment` returns exactly that
data as typed fields, including a structured `urgency` enum
(`can_wait` | `affecting_comfort_now`).

**A hybrid is available and is probably right:** keep emergency detection and
the booking write in code, and add a tool the model calls to *record structured
qualification* — issue, urgency, address. The model is good at extracting; it
should not be trusted to execute.

---

## Where our build is ahead

Each of these is absent from the specification entirely.

| | Why it matters |
|---|---|
| **SMS consent capture** | `smsConsentAt`, the verbatim disclosure, and the source. Without a record, automated texts are unlawful and A2P 10DLC registration fails. The spec's `leads` table has no consent column |
| **STOP / HELP handling** | Carrier requirement. The spec mentions neither |
| **Idempotency** | `Lead.dedupeKey` and `Message.providerMessageId` are unique constraints, so a retried webhook collides at the database. The spec's `leads` table has no uniqueness — a redelivered form submission creates a second lead and a second text |
| **Double-booking prevention** | Unique constraint on `slotKey`, tested concurrently. The spec describes "calendar conflict detection", which is a read-then-write and lets two simultaneous replies both win |
| **An appointments table** | The spec has only `leads` and `conversations`. Appointments live in Google Calendar, so there is no local record to query, count, or reconcile if the Calendar call fails |
| **Postgres** | The spec uses SQLite. Fine for one machine; a problem for concurrent writes, which is where every idempotency guarantee above lives |
| **177 tests** | Against a real database |
| **Dashboard** | Leads, conversations, metrics, with a login |
| **Monthly SMS quota ceiling** | Stops a retry loop spending the 50-message free tier in seconds |

---

## Where the spec is ahead

| | Note |
|---|---|
| **Google Calendar** | Fully specified — read availability, create, update, cancel. Ours has none; `PRD-TRACEABILITY.md` records this as the largest PRD divergence |
| **Structured qualification** | As above. The single most valuable idea in their document |
| **Structured urgency** | An enum, not a keyword match. Ours only distinguishes "emergency" from "not" |
| **Deployment architecture** | Dockerfile, topology, production env vars. Ours has none — `Checklist.md` wants Railway |
| **Sequence and data-flow diagrams** | Ours has prose. Theirs is far easier to hand to another engineer |
| **`issue` as a first-class field** | Separate from the free-text message |

---

## Where they agree, having been reached separately

Worth noting, because independent agreement is evidence:

- Emergency handling escalates to a human and is treated as its own path
- Conversation history is replayed to give the model context
- TextBee for SMS, Anthropic for the model
- Fixed slots offered rather than open-ended scheduling
- Per-deployment configuration through environment variables

---

## Recommendation

**Do not force-push either over the other.** They are unrelated histories and
the spec repo contains a collaborator's work.

1. **Keep `nextjs-rebuild` as a branch** — done. Both implementations survive.
2. **Talk to luislndch before choosing.** They may have context on why the
   Express version exists, and the specification is a better design document
   than anything in this repo.
3. **Take the tool-use idea regardless of which codebase wins.** A
   `record_qualification` tool closes the biggest functional gap in our build,
   and it does not require giving the model the power to execute anything.
4. **Take their deployment section.** We have no Dockerfile and no deployment
   topology, and Railway is on the critical path.
5. **They should take our consent, idempotency and opt-out work regardless.**
   Those are not preferences. Without consent capture the system cannot
   lawfully send, and without unique constraints a retried webhook doubles both
   leads and texts.

The honest summary: **our implementation is more robust, theirs is better
specified, and each has something the other needs.**
