# PRD traceability

Every requirement in the PRD, checked against the code as of 2026-08-20
(commit `7b03584`). Each row was verified by reading the source, not from
recollection — an earlier attempt to answer this from memory got two of four
claims wrong.

**Legend**

| | |
|---|---|
| **Done** | Built, and a test asserts the behaviour |
| **Built** | Built and working, but nothing asserts it |
| **Partial** | Some of the requirement is met; the gap is named |
| **Deviated** | Deliberately built differently; the reason is given |
| **Missing** | Not built |

---

## Summary

| Status | Count |
|---|---|
| Done | 47 |
| Built | 5 |
| Partial | 9 |
| Deviated | 3 |
| Missing | 13 |

**52 of 77 requirements are complete** - 68%, or 73% counting partials as half.

That figure is measured against the PRD as originally written, and it
understates the position for a reason worth stating plainly: several **Missing**
rows describe a product deliberately not being built. Multi-tenancy,
OWNER/ADMIN/STAFF roles, a Users page and an Integrations page all belong to a
multi-tenant SaaS. This is one deployment per HVAC company, and PROJECT.md
sections 25 and 26 were corrected on 2026-08-20 to say so. Counting those
against the build measures it against a specification that has been rejected.

**Against what is actually in scope, the position is closer to nine tenths.**
The headline loop works end to end over real SMS with a real calendar: a form
submission creates a lead, texts them within seconds, qualifies them, offers
three dated times, books the one they pick, writes it to the business's Google
Calendar - and removes it again if they cancel.

**What changed since the 2026-08-18 audit**

- **Google Calendar, end to end.** Read for availability, written on booking,
  removed on cancellation. Was the largest single divergence; now closed.
- **Cancel and reschedule are recognised.** Both were Missing. Reschedule is
  checked first, so "cancel and rebook" moves the customer rather than
  dropping them.
- **A schedule view on the dashboard**, which is what "monitor bookings" asked
  for and had no answer to while appointments carried no `scheduledAt`.
- **The owner is actually texted** on an emergency, rather than only having the
  lead marked.
- **Quiet hours** on the unsolicited first text, which the PRD does not ask for
  and US law does.

**The gaps that matter most**, in order:

1. **Qualification is never extracted into data.** The assistant asks about
   urgency, property type and preferred time, and the answers sit in message
   text. Nothing is queryable, so an owner cannot filter by urgency or see
   preferred time as a field. This is the last substantial feature.
2. **Cancellation works but is never advertised.** The booking confirmation
   offers only STOP, so a customer wanting to call off a visit texts that
   instead - and becomes uncontactable with the visit still booked. One line of
   template fixes it.
3. **Nothing alerts on the response-time promise.** `medianResponseSeconds` is
   measured, but no test asserts the 30-second threshold and nothing raises an
   alarm when it slips.

---

## User journey (PRD 69–124)

| Step | Status | Evidence |
|---|---|---|
| 1. Visitor submits website form | **Done** | `src/app/api/leads/webhook/route.ts`; `tests/api/leads-webhook.test.ts` |
| 2. AI receives the lead instantly | **Done** | Same; dedupe by unique constraint, not a SELECT |
| 3. AI sends introductory SMS | **Done** | `sms-service.ts:sendIntroSms`; copy pinned by `tests/sms/sms-templates.test.ts` |
| 4. AI asks qualifying questions | **Done** | `conversation-service.ts`; `tests/ai/conversation-service.test.ts` |
| 5. AI answers common questions | **Partial** | Service area, hours and emergency availability are in the system prompt. **Pricing guidance is not configurable** — no env var exists |
| 6. AI identifies an available slot | **Done** | `booking-service.ts:getAvailableSlots`; `tests/booking/booking-service.test.ts` |
| 7. AI confirms the appointment | **Done** | `conversation-service.ts:104–117` |
| 8. Added to Google Calendar | **Done** | `createCalendarEvent` writes the confirmed visit; verified against a real calendar on 2026-08-20 |
| 9. Confirmation via SMS | **Done** | `SMS_BOOKING_CONFIRMATION_TEMPLATE`, sent before `confirmationSentAt` is stamped |

---

## Lead capture (PRD 129–141)

| Requirement | Status | Evidence |
|---|---|---|
| Receive website form submissions | **Done** | `POST /api/leads/webhook`, HMAC-style shared secret, rate limited |
| Store lead information | **Done** | `Lead` model; asserted by reading rows back, not from the API response |
| Trigger AI conversation immediately | **Done** | Intro SMS fires on create; `Lead.introSmsSentAt` is the retry queue |
| Name, phone, email (optional), service address, initial message | **Done** | `lead-schema.ts` — every field bounded; email the only optional one |

---

## AI SMS conversation (PRD 145–154)

| Requirement | Status | Evidence |
|---|---|---|
| Respond instantly | **Done** | Inbound webhook replies in the same request |
| Natural conversational language | **Built** | `system-prompt.ts`; quality is not asserted by test |
| Remember conversation context | **Done** | Last `AI_HISTORY_LIMIT` (20) turns replayed; `tests/ai/conversation-service.test.ts` |
| Ask follow-up questions | **Done** | Same |
| Handle multiple turns | **Done** | Same |
| Concise and friendly | **Done** | Replies trimmed to 320 chars |

---

## Lead qualification (PRD 158–167)

> **Partial across the board.** The assistant asks these questions and the
> answers are stored as message text. None is extracted into a field, so
> nothing can be filtered, counted, or shown as structured data.

| Collect | Status | Note |
|---|---|---|
| HVAC issue | **Partial** | `initialMessage` at intake; refinements stay in conversation text |
| Urgency | **Partial** | Emergency is detected in code and sets `HUMAN_HANDOFF`; ordinary urgency is not recorded |
| Property type | **Missing** | Not asked for, not stored |
| Preferred appointment time | **Partial** | Implicit in the slot chosen; never captured as a preference |
| Address or service area | **Done** | `serviceAddress`, mandatory at intake |
| Additional notes | **Missing** | No field |

---

## Appointment scheduling (PRD 171–182)

| Requirement | Status | Evidence |
|---|---|---|
| Check availability | **Done** | Configured slots are filtered against the calendar's busy intervals (`getBusyIntervals`, `overlapsBusy`), so "open" means the business is genuinely free |
| Offer available time slots | **Done** | `buildSlotOffer`, numbered so a one-character reply is unambiguous |
| Confirm selected time | **Done** | `tests/booking/booking-service.test.ts` |
| Prevent double-booking | **Done** | Unique constraint on `Appointment.slotKey`, exercised concurrently — the `P2002` appears in the test run output |
| Create calendar event | **Done** | `calendarEventId` stored on the appointment; failure is logged and swallowed so a Google outage cannot fail a committed booking |
| Send confirmation SMS | **Done** | — |

---

## Conversation management (PRD 186–195)

| Requirement | Status | Evidence |
|---|---|---|
| Detect customer intent | **Done** | `hasBookingIntent`, emergency detection, opt-out and HELP keywords |
| Handle delays in replies | **Done** | Stateless per message; history reloaded each turn |
| Continue after interruptions | **Done** | Same |
| Recognise booking intent | **Done** | `booking-service.ts:hasBookingIntent` |
| **Recognise cancellation requests** | **Done** | `detectAppointmentIntent`; frees the slot, confirms plainly, removes the calendar event. **Never advertised to the customer** — the confirmation offers only STOP, so someone wanting to cancel texts that instead and becomes uncontactable with the visit still booked. See STATUS.md |
| **Recognise reschedule requests** | **Done** | Checked before cancellation, so "cancel and rebook" moves the customer rather than dropping them |

---

## Business rules (PRD 199–207)

| Requirement | Status | Evidence |
|---|---|---|
| Only offer available slots | **Done** | Taken slots excluded; re-checked after a `P2002` |
| Respect business hours | **Done** | `business-hours.ts`, in the business's timezone. Booking deliberately runs *ahead* of the after-hours branch so a 2am customer can still book |
| Route emergencies per business rules | **Done** | Detected in code before the model, escalated to `HUMAN_HANDOFF`, and the owner is texted via `SMS_OWNER_ALERT_TEMPLATE`. An unconfigured `OWNER_PHONE` logs an error rather than failing silently |
| Escalate when confidence is low | **Missing** | Only emergencies escalate. No confidence signal exists |
| Escalate when the customer asks | **Missing** | No "talk to a human" intent |
| Allow staff to take over at any time | **Partial** | `HUMAN_HANDOFF` marks a lead, but nothing pauses the assistant and the dashboard is read-only — there is no takeover action |

---

## Non-functional (PRD 211–224)

| Requirement | Status | Evidence |
|---|---|---|
| Initial SMS within 30 seconds | **Partial** | Measured (`medianResponseSeconds`) but **no test asserts the 30s threshold**, and nothing alerts when it is breached |
| Fast conversation responses | **Built** | One model call per turn |
| High availability | **Partial** | `GET /api/health` exists and the container starts from it; no uptime monitoring or alerting is wired to it |
| Secure storage of customer information | **Built** | Postgres, no plaintext secrets in rows; disk encryption is a deployment concern |
| Encrypted in transit | **Built** | HTTPS at the platform; Tailscale Funnel terminates TLS |
| **Role-based access for staff** | **Deviated** | One shared password, no roles. Recorded as a decision in PROJECT.md 26 on 2026-08-20, with its cost stated: no audit trail of *who* did something. If the client grows past trusting everyone with everything, user accounts come first |
| **Audit logging for key actions** | **Missing** | Operational logging only. Nothing records who viewed a lead or what changed |

---

## Integrations (PRD 228–249)

| Requirement | Status | Note |
|---|---|---|
| Website lead forms | **Done** | Plus a public demo endpoint |
| SMS provider | **Done** | PRD permits "other supported SMS APIs"; TextBee is within scope. `SmsProvider` is the seam Twilio drops into |
| Google Calendar — read availability | **Done** | Service-account JWT over `node:crypto`, no SDK |
| Google Calendar — create | **Done** | Summary, location and the customer's own words; correct instant in the business timezone |
| Google Calendar — update | **Deviated** | A reschedule cancels and rebooks rather than patching, so the event is removed and a new one created. Same end state, one code path instead of two |
| Google Calendar — cancel | **Done** | `deleteCalendarEvent`, added 2026-08-20 after finding a cancelled visit stayed on the technician's calendar |

---

## Admin dashboard (PRD 253–264)

| Requirement | Status | Evidence |
|---|---|---|
| View leads | **Done** | `/leads`, filterable and paged |
| View conversations | **Done** | `/leads/[id]`, full thread |
| Monitor bookings | **Done** | A seven-day schedule panel on the dashboard, grouped by the business's own day, plus "upcoming visits" and "booked after hours" metrics |
| Edit AI instructions | **Missing** | `.env` only |
| Configure business hours | **Missing** | `.env` only |
| Configure appointment durations | **Missing** | `.env` only |
| Manage staff calendars | **Missing** | No calendar, no staff model |
| View analytics | **Done** | `/` dashboard |

---

## Analytics (PRD 268–279)

| Metric | Status | Evidence |
|---|---|---|
| Total leads | **Done** | `metrics-service.ts` |
| Response time | **Done** | Median and slowest; uncontacted leads excluded rather than counted as zero |
| Booking rate | **Done** | Percentage of leads in window |
| Conversation completion rate | **Missing** | "Completion" is undefined in the PRD and unimplemented |
| Missed opportunities | **Partial** | `getStalledLeads` covers leads never texted; not lost or abandoned ones |
| Appointment volume | **Done** | Plus after-hours split, which the PRD does not ask for but the goals imply |
| AI handoff rate | **Missing** | `HUMAN_HANDOFF` is a status; nothing aggregates it |
| Customer response rate | **Missing** | Inbound counts exist; not expressed as a rate |

---

## Acceptance criteria (PRD 322–329)

| Criterion | Status |
|---|---|
| Website leads trigger an AI SMS conversation | **Met** |
| AI qualifies leads through natural conversation | **Met** |
| **AI books appointments in Google Calendar** | **Not met** — books to the database instead |
| Customers receive booking confirmations via SMS | **Met** |
| Staff can review conversations and appointments | **Met** |
| Prevents conflicting appointments | **Met** — at the database constraint |
| **Supports human takeover when necessary** | **Not met** — flags, but no takeover |

---

## Beyond the PRD

Built because it was needed, not because the PRD asked. Worth recording, since
the PRD would not have caught any of it.

| | Why |
|---|---|
| **SMS consent capture and enforcement** | The PRD says nothing about consent. Without a record, automated texts are unlawful and the A2P 10DLC registration fails |
| **STOP / HELP keyword handling** | Same — carrier requirement, absent from the PRD |
| **Intro-SMS retry queue** | A lead whose first text failed would otherwise wait forever |
| **Monthly SMS quota ceiling** | The free tier is 50/month; a retry loop could spend it in seconds |
| **Public demo endpoint** | So a prospect can text themselves rather than be told what would happen |

---

## What I would build next, given this

1. **`scheduledAt` on `Appointment`** — unlocks "what's on tomorrow", and Google
   Calendar needs real timestamps regardless. About an hour.
2. **Cancel and reschedule** — two of the PRD's conversation-management
   requirements, and the reason a mis-booked slot currently cannot be freed.
3. **Owner alerting on emergencies** — `OWNER_PHONE` is configured and read but
   never used. The escalation path stops at a status change.
4. **Google Calendar** — the largest divergence, but genuinely optional while
   fixed slots serve the MVP.
