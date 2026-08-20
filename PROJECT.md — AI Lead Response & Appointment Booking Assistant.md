# AI Lead Response & Appointment Booking Assistant for HVAC Service Businesses

## Project Overview

Build a production-ready SaaS platform that helps HVAC service businesses automatically respond to new website leads via SMS, qualify their HVAC needs through an AI-powered conversation, and convert qualified leads into booked appointments on Google Calendar.

The core workflow is:

**Website Lead → Immediate SMS → AI Conversation → Lead Qualification → Appointment Selection → Google Calendar Booking → SMS Confirmation**

The primary business outcome is to increase the percentage of website leads that become booked appointments while reducing the amount of manual work required from office staff.

---

# 1. Product Vision

HVAC companies frequently lose potential customers because website leads are not contacted quickly enough.

This product acts as an AI receptionist for inbound website leads.

When someone submits a website form, the platform should:

1. Receive the lead.
2. Create a lead record.
3. Immediately initiate an SMS conversation.
4. Understand the customer's HVAC issue.
5. Ask relevant qualification questions.
6. Determine whether the lead is appropriate for the business.
7. Answer common questions using the business's configured knowledge.
8. Offer appropriate appointment times.
9. Book the selected appointment in Google Calendar.
10. Send confirmation to the customer.
11. Escalate to a human when necessary.

The AI should feel like a helpful scheduling assistant, not a generic chatbot.

---

# 2. Target Customers

## Primary Customer

HVAC service businesses, including:

- Residential HVAC contractors
- Air conditioning repair companies
- Heating companies
- HVAC installation companies
- Heating and cooling service companies

## Internal Users

### Business Owner / Manager

Needs:

- Lead and booking overview
- Conversation visibility
- AI configuration
- Business configuration
- Calendar configuration
- Analytics
- Human takeover

### Office Staff / Dispatcher

Needs:

- Lead inbox
- Conversation history
- Appointment information
- Manual takeover
- Lead status management

### Admin

Needs:

- Business settings
- Users
- Integrations
- AI configuration
- System configuration

---

# 3. Core Problem

HVAC businesses commonly experience:

- Slow lead response
- Leads contacting multiple HVAC companies
- Missed after-hours opportunities
- Staff spending time texting leads
- Inconsistent lead qualification
- Manual appointment scheduling
- Calendar coordination problems
- Poor visibility into lead conversion

The system should reduce these problems through immediate automated engagement.

---

# 4. Product Goals

## Primary Goals

1. Respond to new leads within seconds.
2. Start a natural SMS conversation automatically.
3. Qualify leads without requiring staff intervention.
4. Convert qualified leads into appointments.
5. Create appointments directly in Google Calendar.
6. Give staff complete visibility into conversations.
7. Allow human takeover at any time.
8. Provide measurable lead-to-booking analytics.

## Secondary Goals

- Improve after-hours conversion.
- Reduce administrative workload.
- Standardize lead qualification.
- Improve customer response experience.
- Create a scalable foundation for additional AI receptionist functionality.

---

# 5. MVP Scope

## Included

- Business accounts
- User authentication
- Role-based access
- Website lead intake
- Lead management
- SMS integration
- AI conversation engine
- Conversation history
- Lead qualification
- Business knowledge/configuration
- Google Calendar integration
- Appointment scheduling
- Appointment confirmation
- Human takeover
- Basic analytics
- Audit logs

## Not Included in MVP

- AI voice calling
- Full CRM
- Technician dispatching
- Payment processing
- Automated quoting
- Advanced marketing automation
- Native mobile application
- Multi-location optimization
- Complex field-service management
- Automatic diagnosis of HVAC equipment problems

These may be considered in later releases.

---

# 6. Core User Journey

## 6.1 Website Lead Submission

A potential customer submits a website form.

Example information:

- First name
- Last name
- Phone number
- Email
- Service address
- Message
- Lead source

The website sends the lead to the platform.

The platform creates a lead immediately.

---

# 7. Lead Intake API

Create an API endpoint for website forms.

Example:

`POST /api/leads`

Example payload:

```json
{
  "firstName": "John",
  "lastName": "Smith",
  "phone": "+15555550123",
  "email": "john@example.com",
  "serviceAddress": "123 Main St",
  "message": "My AC is running but not cooling.",
  "source": "website"
}
```

Requirements:

- Validate required fields.
- Normalize phone numbers.
- Detect duplicate leads where appropriate.
- Create the lead.
- Create the initial conversation.
- Trigger the AI/SMS workflow.

The endpoint should respond quickly and process downstream messaging asynchronously where appropriate.

---

# 8. Lead Management

Each lead should have:

- ID
- Name
- Phone
- Email
- Address
- Initial inquiry
- Source
- Status
- Created timestamp
- Last contacted timestamp
- Assigned user
- Qualification data
- Appointment information

## Lead Statuses

Support:

- NEW
- CONTACTED
- ENGAGED
- QUALIFIED
- APPOINTMENT_PENDING
- BOOKED
- HUMAN_HANDOFF
- NOT_QUALIFIED
- LOST
- CLOSED

---

# 9. SMS Conversation

The system should automatically send an SMS after lead creation.

Example:

> Hi John! Thanks for contacting ABC HVAC. I'm here to help. Can you tell me a little about what's happening with your HVAC system?

The exact wording should be configurable.

The AI should:

- Respond naturally.
- Maintain conversation context.
- Ask relevant follow-up questions.
- Avoid asking questions unnecessarily.
- Keep messages concise.
- Recognize when the customer wants to book.
- Recognize when the customer wants a human.
- Handle common objections.
- Handle rescheduling/cancellation requests.
- Stop or escalate when appropriate.

---

# 10. AI Conversation Rules

The AI should behave as a helpful HVAC scheduling assistant.

## The AI SHOULD

- Be concise.
- Be polite.
- Ask one or two useful questions at a time.
- Focus on getting the customer to the appropriate next step.
- Use the business's configured information.
- Offer appointment times when appropriate.
- Confirm important details before booking.
- Escalate when uncertain.

## The AI SHOULD NOT

- Pretend to be a human.
- Claim to have inspected equipment.
- Provide unsafe technical instructions.
- Make unsupported diagnoses.
- Promise pricing that has not been configured.
- Invent availability.
- Invent company policies.
- Book appointments outside configured availability.
- Continue automated conversation after a human takeover unless explicitly re-enabled.

---

# 11. HVAC Qualification

The system should collect relevant information depending on the conversation.

Potential information includes:

- HVAC issue
- Heating vs cooling
- Whether equipment is currently working
- Approximate onset of issue
- Urgency
- Property type
- Service address
- Customer availability
- Existing customer status
- Preferred appointment time

The AI should not force every customer through a rigid questionnaire.

Qualification should be conversational.

---

# 12. Emergency / Safety Handling

The system must have configurable escalation rules.

If a customer reports a potentially dangerous situation, the AI should not attempt to diagnose or provide risky repair instructions.

Instead, follow the HVAC business's configured emergency policy and escalate to a human or appropriate emergency service when necessary.

The exact policy should be configurable per business.

---

# 13. Business Knowledge Base

Each HVAC business should be able to configure information the AI can use.

Examples:

### Business Information

- Company name
- Description
- Phone
- Address
- Service area

### Services

- AC repair
- Heating repair
- HVAC maintenance
- Installation
- Replacement
- Indoor air quality

### Service Areas

Examples:

- City
- ZIP code
- Service radius

### Policies

- Emergency service policy
- Cancellation policy
- Service fee policy
- Hours
- Booking rules

### FAQ

Businesses can provide common customer questions and answers.

The AI must only use configured information or approved system knowledge.

---

# 14. AI Configuration

Business administrators should be able to configure:

- AI personality
- Greeting
- Business description
- Services
- Qualification questions
- Service areas
- Business hours
- Booking rules
- Escalation rules
- FAQ
- Human handoff behavior

Avoid exposing technical AI settings to ordinary users unless necessary.

---

# 15. Conversation Management

Create a conversation inbox.

Each conversation should display:

- Lead name
- Phone
- Lead status
- Last message
- Last activity
- AI/human status
- Appointment status

Conversation view should display messages chronologically.

Clearly distinguish:

- Customer messages
- AI messages
- Staff messages
- System events

---

# 16. Human Handoff

Human takeover is a core MVP feature.

Staff should be able to take control of a conversation.

When human takeover is active:

- AI stops sending automated messages.
- Staff can send SMS messages.
- Conversation status becomes HUMAN_HANDOFF.
- The system records who took over and when.

Staff should be able to return the conversation to AI when appropriate.

The system must clearly show whether AI or a human currently controls the conversation.

---

# 17. Appointment Scheduling

The AI should be able to determine when a customer is ready to schedule.

The workflow:

1. AI determines customer wants an appointment.
2. System checks Google Calendar availability.
3. System identifies valid appointment slots.
4. AI presents available options.
5. Customer selects a slot.
6. System re-checks availability.
7. System creates the calendar event.
8. System records the appointment.
9. Customer receives SMS confirmation.

Never assume a previously available slot remains available.

Always re-check before creating the appointment.

---

# 18. Google Calendar Integration

Implement OAuth-based Google Calendar integration.

Required functionality:

- Connect Google account
- Select calendar
- Read availability
- Create events
- Update events
- Cancel events

Appointment configuration should support:

- Appointment duration
- Buffer time
- Business hours
- Days available
- Calendar to use

The system should prevent double booking.

---

# 19. Appointment Entity

Store:

- ID
- Lead ID
- Customer name
- Customer phone
- Service address
- Appointment start
- Appointment end
- Google Calendar event ID
- Status
- Created timestamp
- Updated timestamp

Statuses:

- PENDING
- CONFIRMED
- CANCELLED
- RESCHEDULED
- COMPLETED
- NO_SHOW

---

# 20. Appointment Confirmation

After successful booking, send an SMS.

The confirmation should include:

- Business name
- Appointment date
- Appointment time
- Service address if appropriate
- Relevant instructions

Example:

> You're all set! Your HVAC appointment is confirmed for Tuesday at 10:00 AM. We'll see you then.

Do not claim that a technician will arrive at an exact time unless the business's scheduling model supports that claim.

---

# 21. Rescheduling & Cancellation

Customers should be able to request:

- Cancellation
- Rescheduling

The AI should identify the intent and guide the customer through the appropriate workflow.

For rescheduling:

1. Identify the existing appointment.
2. Retrieve new availability.
3. Offer valid slots.
4. Confirm selection.
5. Update Google Calendar.
6. Send confirmation.

---

# 22. Dashboard

Create a business dashboard showing:

- New leads
- Leads contacted
- Active conversations
- Qualified leads
- Appointments booked
- Booking conversion rate
- Appointments today
- Human handoffs
- Average response time

Allow date filtering.

---

# 23. Analytics

Track:

### Lead Metrics

- Total leads
- Leads by source
- Response time
- Engagement rate
- Qualification rate

### Booking Metrics

- Appointments booked
- Lead-to-booking conversion
- Booking rate by day/time
- Booking rate by source

### AI Metrics

- AI conversations
- Human handoffs
- AI booking rate
- Failed conversations
- Escalation rate

Analytics must be calculated from actual database data.

Do not use hard-coded demo metrics in production views.

---

# 24. Database Entities

At minimum implement:

- Organization
- User
- Role
- Lead
- Conversation
- Message
- AIConfiguration
- KnowledgeItem
- Qualification
- Appointment
- BusinessHours
- CalendarIntegration
- AuditLog

Relationships must support multiple businesses using the platform.

All business data must be isolated by organization.

---

# 25. Single Tenancy

**Corrected 2026-08-20.** This section previously specified a multi-tenant SaaS
application. That is not what is being built, and the contradiction was
resurfacing in every working session.

The product is **single-tenant**: one deployment per HVAC company, customized
for that company. Not a SaaS platform.

## What that means

There is no `Organization` model, no `organizationId` column, and no
tenant-scoped query layer. Isolation between businesses is achieved by them not
sharing a deployment: separate application instance, separate database,
separate Google Calendar credentials, separate SMS sender.

The requirement that "a user from Organization A must never access
Organization B's data" is satisfied absolutely rather than by enforcement code
— there is no Organization B in the process, the database, or the schema.

## Per-client customization

`src/config/business.ts` is the seam. Business name, timezone, country code,
service area, hours, message templates and booking slots are read from
configuration rather than hardcoded. Swapping that configuration and redeploying
is how one client becomes the next, and it is also the seam for adapting to a
service vertical other than HVAC.

Client-specific secrets — Google service account, SMS provider credentials,
webhook secrets — live in that deployment's `.env` and belong to that client.

## Why this, and what it costs

A single-tenant deployment removes an entire category of the most damaging bug
this product could have: one business seeing another's customers. It also
removes the need for authentication to carry tenant identity, which is why the
dashboard has a single shared login rather than user accounts.

The cost is operational. Ten clients means ten deployments, ten databases and
ten sets of credentials to rotate. That is a deliberate trade: at the scale this
product is sold, per-client operations are cheaper than the engineering and the
risk of getting tenant isolation wrong.

## If multi-tenancy is ever required

It is a rewrite of the data layer, not a feature toggle. Every query would need
tenant scoping, authentication would need to carry tenant identity, and every
existing row would need backfilling into an organization. Deciding to build a
SaaS platform is a decision to start that work deliberately — not something to
be arrived at by adding a column.

## Related contradictions still outstanding

Section 26 (Roles & Permissions) specifies OWNER / ADMIN / STAFF roles, which
this build also does not have, for the same reason: there is one business and
one login. `STANDARDS.md` §13, §14, §15 and §57.3 carry the same multi-tenant
assumption and have not been amended.

---

# 26. Roles & Permissions

## OWNER

Full organization access.

## ADMIN

Operational and configuration access.

## STAFF

Access to leads, conversations, appointments, and permitted operational actions.

Permissions should be enforced on the backend.

---

# 27. Main Application Navigation

Recommended navigation:

1. Dashboard
2. Leads
3. Conversations
4. Appointments
5. Calendar
6. Analytics
7. AI Settings
8. Business Settings
9. Users
10. Integrations

---

# 28. Lead Inbox

The lead inbox should support:

- Search
- Status filtering
- Date filtering
- Assigned staff
- Booking status

Each lead should have a clear visual indicator for:

- New
- AI engaged
- Waiting for customer
- Qualified
- Booked
- Human handoff

---

# 29. Staff Experience

Optimize the staff workflow around:

**Lead → Conversation → Qualification → Appointment**

A staff member should be able to understand the current state of a lead immediately.

The interface should clearly display:

- Customer details
- Conversation
- Qualification information
- Appointment
- AI status
- Human takeover control

---

# 30. Security

Implement:

- Secure authentication
- Server-side authorization
- Tenant isolation
- Encrypted network traffic
- Secure OAuth token storage
- Environment variables for secrets
- Input validation
- Rate limiting for public lead endpoints
- Protection against unauthorized API access
- Audit logging

Never expose Google OAuth refresh tokens to the browser.

Never commit API keys or secrets to source control.

---

# 31. Webhook Security

The website lead endpoint and SMS provider webhooks are public-facing.

Implement:

- Signature verification where supported
- Request validation
- Idempotency
- Rate limiting
- Logging
- Duplicate event handling

A webhook may be delivered more than once. Processing the same event twice must not create duplicate leads, messages, or appointments.

---

# 32. AI Reliability

AI output must not directly perform sensitive actions without validation.

For example, the AI should not directly create a calendar event using arbitrary generated parameters.

Instead:

**AI Intent → Structured Action → Server Validation → Tool Execution**

Example:

```text
AI determines:
BOOK_APPOINTMENT

Structured parameters:
{
  leadId,
  requestedTime,
  duration
}

Server validates:
- lead exists
- organization matches
- customer is eligible
- time is valid
- calendar is connected
- slot is still available

Then:
Create Google Calendar event
```

The backend remains the source of truth.

---

# 33. AI Tooling

Design the AI layer around controlled tools/functions such as:

- `getLead()`
- `getBusinessInfo()`
- `getKnowledge()`
- `getAvailableAppointmentSlots()`
- `createAppointment()`
- `cancelAppointment()`
- `rescheduleAppointment()`
- `requestHumanHandoff()`

AI should not have unrestricted database access.

---

# 34. Conversation State

Persist conversation state.

Possible states:

- INITIAL
- QUALIFYING
- ANSWERING_QUESTION
- READY_TO_BOOK
- BOOKING
- BOOKED
- HUMAN_HANDOFF
- CLOSED

The system should be able to resume a conversation after delays or application restarts.

---

# 35. SMS Provider

Create an SMS abstraction layer.

The application should not tightly couple business logic to one provider.

Example interface:

```text
SmsProvider
  sendMessage()
  receiveMessage()
  validateWebhook()
```

A provider such as Twilio can be implemented initially.

Keep the architecture open to other providers.

---

# 36. AI Provider

Create an AI service abstraction.

Example:

```text
AiProvider
  generateResponse()
  extractIntent()
  extractStructuredData()
```

Keep provider-specific code isolated.

AI prompts should be versioned and maintainable.

---

# 37. Error Handling

Handle:

- SMS delivery failure
- AI provider failure
- Google OAuth failure
- Calendar API failure
- Calendar slot disappearing
- Invalid lead data
- Duplicate webhook
- Rate limit
- Human handoff
- Database failure

The system should fail safely.

For example, if calendar booking fails, the AI must not tell the customer that an appointment was booked.

---

# 38. Notifications

MVP should support SMS notifications for:

- Initial lead response
- Appointment confirmation
- Appointment cancellation
- Appointment rescheduling

Future notification channels:

- Email
- WhatsApp
- Voice

---

# 39. Testing

Create automated tests for critical workflows.

## Lead Intake

- Valid lead accepted
- Invalid lead rejected
- Duplicate webhook handled
- Lead created correctly

## SMS

- Message sent
- Incoming message processed
- Duplicate message ignored
- Failed delivery handled

## AI

- Qualification flow
- Booking intent detection
- Human handoff detection
- AI cannot bypass authorization

## Calendar

- Availability retrieved
- Appointment created
- Double-booking prevented
- Rescheduling works
- Cancellation works

## Multi-Tenancy

- Organization A cannot access Organization B data.
- Users cannot access unauthorized resources.

## Security

- Unauthorized API requests rejected.
- Invalid webhook signatures rejected.
- Protected routes require authentication.

---

# 40. Seed Data

Create development seed data for:

- One HVAC organization
- Owner
- Admin
- Staff user
- Several leads
- Several conversations
- Example AI configuration
- Example knowledge base
- Appointments
- Business hours

Create realistic example HVAC inquiries such as:

- AC not cooling
- Furnace not heating
- HVAC maintenance request
- System replacement inquiry

Do not present seeded data as real customer data.

---

# 41. UI Requirements

The interface should be a professional SaaS dashboard.

Important screens:

### Dashboard

Operational metrics and alerts.

### Leads

Table/list with filters.

### Lead Detail

Customer information + qualification + conversation + appointment.

### Conversations

Inbox-style interface.

### Appointments

Calendar/list view.

### AI Settings

Business-specific AI configuration.

### Integrations

Google Calendar and SMS configuration.

### Business Settings

Business information, hours, service areas, policies.

---

# 42. Empty, Loading & Error States

Every major screen must handle:

- Loading
- Empty
- Error
- Success

Do not leave blank screens when data is unavailable.

Examples:

"No leads yet"

"No appointments scheduled"

"Google Calendar is not connected"

"Unable to load conversations. Try again."

---

# 43. Accessibility

Use accessible:

- Buttons
- Forms
- Labels
- Keyboard navigation
- Focus states
- Dialogs
- Tables
- Status indicators

Do not rely solely on color to communicate status.

---

# 44. Performance

Optimize for:

- Fast lead creation
- Fast conversation loading
- Fast lead search
- Efficient message retrieval
- Efficient dashboard queries

Public lead intake should not wait for the entire AI/SMS workflow to complete.

Use background jobs/queues where appropriate.

---

# 45. Observability

Log important system events.

Include:

- Lead received
- SMS sent
- SMS received
- AI response generated
- Tool invocation
- Appointment created
- Appointment failed
- Human handoff
- Integration failure

Do not log sensitive credentials or unnecessary private customer information.

---

# 46. Development Approach

Build the application in vertical slices.

## Phase 1 — Foundation

- Project setup
- Database
- Multi-tenancy
- Authentication
- Authorization
- Application shell

## Phase 2 — Lead Management

- Lead API
- Lead database
- Lead list
- Lead detail
- Search/filtering

## Phase 3 — SMS

- SMS provider abstraction
- Outbound messages
- Inbound webhook
- Conversation storage

## Phase 4 — AI

- AI provider abstraction
- System prompt
- Conversation state
- Qualification
- Controlled tools
- Human handoff

## Phase 5 — Google Calendar

- OAuth
- Calendar connection
- Availability
- Appointment creation
- Rescheduling
- Cancellation

## Phase 6 — Dashboard & Analytics

- Metrics
- Conversion funnel
- Booking analytics
- Response-time analytics

## Phase 7 — Hardening

- Tests
- Security review
- Error handling
- Rate limiting
- Webhook idempotency
- Accessibility
- Performance

---

# 47. Definition of Done

The MVP is complete when this end-to-end workflow works using real persistent data:

```text
Website visitor
      ↓
Website form submitted
      ↓
Lead created
      ↓
SMS automatically sent
      ↓
Customer replies
      ↓
AI processes response
      ↓
AI qualifies lead
      ↓
Customer requests appointment
      ↓
System retrieves Google Calendar availability
      ↓
AI offers available slots
      ↓
Customer selects slot
      ↓
Server validates availability
      ↓
Google Calendar appointment created
      ↓
Appointment stored in database
      ↓
SMS confirmation sent
      ↓
Dashboard shows booked appointment
```

A staff member must also be able to enter the conversation at any point and take over from the AI.

---

# 48. Development Rules

Do not:

- Use fake functionality where real functionality is required.
- Hard-code appointments.
- Hard-code calendar availability.
- Allow AI-generated text to directly execute unrestricted database operations.
- Store secrets in source control.
- Trust client-side authorization.
- Assume a calendar slot is available without checking.
- Create duplicate records from repeated webhooks.
- Tell customers an appointment is booked until the calendar operation succeeds.

Keep business logic on the server.

Keep external integrations behind service abstractions.

Keep AI actions structured and validated.

---

# 49. Documentation

Maintain documentation for:

- Local setup
- Environment variables
- Database setup
- Migrations
- Seed data
- Authentication
- SMS configuration
- Google OAuth configuration
- AI provider configuration
- Testing
- Production deployment
- Architecture decisions

Create an `.env.example`.

Never put actual production credentials in documentation.

---

# 50. Recommended Environment Variables

Use environment variables for values such as:

```text
DATABASE_URL=
AUTH_SECRET=

AI_PROVIDER=
AI_API_KEY=

SMS_PROVIDER=
SMS_ACCOUNT_ID=
SMS_AUTH_TOKEN=
SMS_PHONE_NUMBER=

GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=

APP_URL=
```

Use the actual variables required by the selected technology stack/provider.

---

# 51. Final Instruction to AI Coding Agent

When starting work:

1. Inspect the repository.
2. Identify the existing stack.
3. Do not unnecessarily replace existing technologies.
4. Propose the architecture briefly.
5. Create an implementation plan.
6. Begin implementation immediately.
7. Build in the phases above.
8. Run tests continuously.
9. Fix errors before moving on.
10. Keep the application runnable after every major phase.
11. Never claim functionality is complete unless it actually works.
12. Clearly document assumptions and unresolved issues.

At the end of each development session, report:

### Completed

List implemented functionality.

### Tests

List tests run and their results.

### Remaining

List incomplete functionality.

### Known Issues

List bugs or limitations.

### Next Recommended Step

Identify the next highest-priority implementation task.

The goal is not to produce a demonstration. The goal is to build a maintainable, secure, production-ready foundation for an HVAC AI lead-response and appointment-booking SaaS product.