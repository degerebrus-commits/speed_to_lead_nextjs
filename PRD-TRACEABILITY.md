# PRD traceability

Every requirement in the PRD, checked against the code as of 2026-08-18
(commit `edd5862`). Each row was verified by reading the source, not from
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
| Done | 21 |
| Built | 3 |
| Partial | 6 |
| Deviated | 2 |
| Missing | 13 |

**The MVP's headline promise works**: a form submission creates a lead, texts
the customer within seconds, qualifies them over SMS, books a slot, and
confirms it. That path is tested end to end.

**The three gaps that matter most**, in order:

1. **Google Calendar is absent entirely** (PRD lines 10, 119, 173–182,
   244–249, 290, 326). Fixed slots work and need no calendar, but the PRD
   names Calendar in the opening purpose statement and in the acceptance
   criteria. This is the largest single divergence.
2. **Qualification is never extracted into data.** The assistant asks about
   urgency, property type and preferred time, and the answers sit in message
   text. Nothing is queryable, so an owner cannot filter by urgency or see
   preferred time as a field.
3. **No cancel or reschedule handling.** The PRD asks for both. A customer
   texting "cancel my appointment" is currently treated as an ordinary
   message, and no code path ever sets `AppointmentStatus.CANCELLED`, so a
   booked slot cannot be released from inside the product.

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
| 8. Added to Google Calendar | **Missing** | Fixed slots only — see Deviations |
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
| Check availability | **Deviated** | Against configured fixed slots, not a calendar |
| Offer available time slots | **Done** | `buildSlotOffer`, numbered so a one-character reply is unambiguous |
| Confirm selected time | **Done** | `tests/booking/booking-service.test.ts` |
| Prevent double-booking | **Done** | Unique constraint on `Appointment.slotKey`, exercised concurrently — the `P2002` appears in the test run output |
| Create calendar event | **Missing** | — |
| Send confirmation SMS | **Done** | — |

---

## Conversation management (PRD 186–195)

| Requirement | Status | Evidence |
|---|---|---|
| Detect customer intent | **Done** | `hasBookingIntent`, emergency detection, opt-out and HELP keywords |
| Handle delays in replies | **Done** | Stateless per message; history reloaded each turn |
| Continue after interruptions | **Done** | Same |
| Recognise booking intent | **Done** | `booking-service.ts:hasBookingIntent` |
| **Recognise cancellation requests** | **Missing** | "Cancel my appointment" is treated as an ordinary message. Nothing sets `CANCELLED`, so a slot cannot be released in-product |
| **Recognise reschedule requests** | **Missing** | Not detected |

---

## Business rules (PRD 199–207)

| Requirement | Status | Evidence |
|---|---|---|
| Only offer available slots | **Done** | Taken slots excluded; re-checked after a `P2002` |
| Respect business hours | **Done** | `business-hours.ts`, in the business's timezone. Booking deliberately runs *ahead* of the after-hours branch so a 2am customer can still book |
| Route emergencies per business rules | **Partial** | Detected in code before the model and escalated to `HUMAN_HANDOFF`; **the owner is not actually alerted** — `OWNER_PHONE` is read but no notification is sent |
| Escalate when confidence is low | **Missing** | Only emergencies escalate. No confidence signal exists |
| Escalate when the customer asks | **Missing** | No "talk to a human" intent |
| Allow staff to take over at any time | **Partial** | `HUMAN_HANDOFF` marks a lead, but nothing pauses the assistant and the dashboard is read-only — there is no takeover action |

---

## Non-functional (PRD 211–224)

| Requirement | Status | Evidence |
|---|---|---|
| Initial SMS within 30 seconds | **Partial** | Measured (`medianResponseSeconds`) but **no test asserts the 30s threshold**, and nothing alerts when it is breached |
| Fast conversation responses | **Built** | One model call per turn |
| High availability | **Missing** | No health check, no uptime monitoring |
| Secure storage of customer information | **Built** | Postgres, no plaintext secrets in rows; disk encryption is a deployment concern |
| Encrypted in transit | **Built** | HTTPS at the platform; Tailscale Funnel terminates TLS |
| **Role-based access for staff** | **Deviated** | One shared password, no roles — single-tenant decision. If the client has staff needing different access, this is unmet |
| **Audit logging for key actions** | **Missing** | Operational logging only. Nothing records who viewed a lead or what changed |

---

## Integrations (PRD 228–249)

| Requirement | Status | Note |
|---|---|---|
| Website lead forms | **Done** | Plus a public demo endpoint |
| SMS provider | **Done** | PRD permits "other supported SMS APIs"; TextBee is within scope. `SmsProvider` is the seam Twilio drops into |
| Google Calendar — read availability | **Missing** | |
| Google Calendar — create | **Missing** | |
| Google Calendar — update | **Missing** | |
| Google Calendar — cancel | **Missing** | |

---

## Admin dashboard (PRD 253–264)

| Requirement | Status | Evidence |
|---|---|---|
| View leads | **Done** | `/leads`, filterable and paged |
| View conversations | **Done** | `/leads/[id]`, full thread |
| Monitor bookings | **Partial** | Appointments show per lead and in aggregate; **there is no "what's on tomorrow" view**, because `Appointment` has no `scheduledAt` — only a slot label string |
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
