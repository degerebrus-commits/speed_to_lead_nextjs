# STANDARDS.md

# AI Lead Response & Appointment Booking Assistant
## Engineering, Product, AI, Security & UX Standards

**Document Status:** Active  
**Version:** 1.0  
**Purpose:** Establish mandatory standards for developing and maintaining the HVAC AI Lead Response & Appointment Booking Assistant.

---

# 1. Purpose

This document defines the engineering standards that all contributors and AI coding agents must follow when working on this project.

The goal is to ensure the product remains:

- Secure
- Reliable
- Maintainable
- Testable
- Multi-tenant
- User-friendly
- AI-safe
- Production-ready

These standards apply to:

- Application code
- APIs
- Database changes
- AI behavior
- Integrations
- UI/UX
- Tests
- Documentation
- Infrastructure

---

# 2. Core Principles

The following principles take priority over speed of implementation.

## 2.1 Correctness Over Convenience

Do not implement shortcuts that can cause incorrect:

- Appointments
- Lead records
- Customer communications
- Payment-related information
- Business configuration
- Tenant access

---

## 2.2 Server Is the Source of Truth

The backend must be authoritative for:

- Authentication
- Authorization
- Tenant isolation
- Appointment availability
- Appointment creation
- Lead status
- Conversation state
- Business rules

Never trust values supplied by the browser.

---

## 2.3 AI Is Not the Source of Truth

AI-generated output must never independently determine sensitive system state.

Use:

```text
AI Intent
    ↓
Structured Action
    ↓
Server Validation
    ↓
Business Rules
    ↓
Tool Execution
    ↓
Verified Result
    ↓
AI Response
```

The AI proposes actions.

The application validates and executes them.

---

## 2.4 Fail Safely

When uncertain, the system should prefer:

- Human handoff
- Clear customer communication
- No appointment creation
- No unsupported claims

over making an incorrect assumption.

---

# 3. Technology Standards

Use the existing project's technology stack unless there is a documented reason to change it.

Before introducing a new framework, library, database, service, or infrastructure component:

1. Check whether the project already provides equivalent functionality.
2. Consider maintenance cost.
3. Consider security implications.
4. Consider bundle/runtime impact.
5. Document the decision when significant.

Avoid unnecessary dependencies.

---

# 4. Repository Standards

Keep the repository organized and predictable.

Recommended high-level structure:

```text
src/
├── app/
├── components/
├── server/
├── db/
├── lib/
└── tests/
```

Adapt this to the actual framework.

Do not create architectural layers merely for the sake of abstraction.

---

# 5. Naming Conventions

Use clear, descriptive names.

## Files

Prefer:

```text
lead-service.ts
appointment-service.ts
calendar-provider.ts
```

over:

```text
helper.ts
misc.ts
utils2.ts
```

## Functions

Use verbs:

```text
createLead()
getAvailableSlots()
sendSms()
cancelAppointment()
```

## Boolean Variables

Use descriptive prefixes:

```text
isActive
hasAppointment
canBook
isHumanHandoff
```

---

# 6. Type Safety

Prefer strong types over loosely typed objects.

Avoid:

```typescript
any
```

unless there is a documented reason.

Validate data at system boundaries.

External data must be treated as untrusted.

Examples:

- Website forms
- SMS webhooks
- Google Calendar responses
- AI-generated structured output
- Query parameters
- Request bodies

---

# 7. Input Validation

Every external input must be validated.

Validate:

- Required fields
- Data types
- String lengths
- Email format
- Phone format
- Dates
- Times
- IDs
- Enum values
- Numeric ranges

Use a consistent validation library/pattern throughout the application.

Do not rely only on frontend validation.

---

# 8. API Standards

APIs should:

- Use consistent naming.
- Return predictable response structures.
- Validate input.
- Enforce authorization.
- Enforce tenant isolation.
- Handle errors consistently.
- Avoid leaking internal implementation details.

Example:

```text
POST /api/leads
GET  /api/leads
GET  /api/leads/:id
PATCH /api/leads/:id
```

Use appropriate HTTP methods.

---

# 9. API Error Handling

Never expose raw stack traces or sensitive implementation details to users.

Use meaningful errors.

Example:

```json
{
  "error": {
    "code": "APPOINTMENT_SLOT_UNAVAILABLE",
    "message": "That appointment time is no longer available."
  }
}
```

Errors should be:

- Actionable
- Safe
- Consistent

---

# 10. Database Standards

Database integrity is critical.

Use:

- Foreign keys where appropriate
- Unique constraints
- Indexes for frequently queried fields
- Transactions for multi-step critical operations
- Migrations for schema changes

Do not modify production schemas manually without a migration.

---

# 11. Database IDs

Use a consistent ID strategy throughout the project.

Do not mix multiple ID formats without a clear reason.

IDs exposed through APIs should not unnecessarily reveal internal sequential database identifiers.

---

# 12. Database Transactions

Use transactions when multiple operations must succeed or fail together.

Example:

```text
Create Appointment
    +
Create Booking Record
    +
Update Lead Status
```

If a critical operation fails, the system must not leave inconsistent state.

---

# 13. Multi-Tenancy

Tenant isolation is mandatory.

Every organization-owned resource must be associated with an organization.

Examples:

```text
Lead.organizationId
Conversation.organizationId
Appointment.organizationId
KnowledgeItem.organizationId
```

Every server-side query must enforce tenant scope.

Never rely on:

```text
organizationId
```

provided by the browser without validating the authenticated user's organization.

---

# 14. Authorization

Authorization must happen server-side.

Never assume that hiding a button prevents access.

For every protected action verify:

1. User is authenticated.
2. User belongs to the organization.
3. User has the required permission.
4. Resource belongs to the organization.

---

# 15. Role Standards

## OWNER

Can:

- Manage organization
- Manage users
- Manage integrations
- Manage AI configuration
- View all leads
- View analytics
- Manage appointments

## ADMIN

Can:

- Manage leads
- Manage conversations
- Manage appointments
- Configure operational settings
- View analytics
- Manage approved business information

## STAFF

Can:

- View assigned/permitted leads
- Respond to conversations
- Take over conversations
- View appointments
- Perform permitted operational actions

Staff should not have unrestricted access to sensitive configuration.

---

# 16. Authentication

Authentication must use established security practices.

Requirements:

- Secure password handling if passwords are used
- Secure sessions
- Session expiration
- Logout support
- Protected routes
- Account status checks

Never store plaintext passwords.

Never log passwords or authentication tokens.

---

# 17. Secrets Management

Secrets must never be committed to source control.

Examples:

```text
AI_API_KEY
SMS_AUTH_TOKEN
GOOGLE_CLIENT_SECRET
DATABASE_URL
AUTH_SECRET
```

Use environment variables or a secure secrets manager.

Maintain:

```text
.env.example
```

without real credentials.

---

# 18. Logging Standards

Logs should help diagnose problems without exposing private data.

Good:

```text
Appointment creation failed for organization <id>
```

Avoid logging:

- API keys
- OAuth tokens
- Passwords
- Full message histories unnecessarily
- Sensitive customer information unnecessarily

---

# 19. Audit Logging

Record important business actions.

Examples:

- Lead created
- Lead updated
- Membership/configuration changed
- AI settings changed
- Human takeover
- Appointment created
- Appointment cancelled
- Appointment rescheduled
- User permission changed
- Integration connected/disconnected

Each audit record should contain:

- Actor
- Organization
- Action
- Entity
- Entity ID
- Timestamp
- Relevant metadata

---

# 20. AI Standards

The AI is an assistant, not the system of record.

AI responses must be grounded in:

- Business configuration
- Approved knowledge
- Conversation context
- Verified system data

The AI must not invent:

- Appointment availability
- Pricing
- Service areas
- Company policies
- Technician availability
- Guarantees

---

# 21. AI Prompt Standards

Prompts should clearly define:

1. Role
2. Business context
3. Allowed behavior
4. Forbidden behavior
5. Available tools
6. Escalation rules
7. Output requirements

Keep prompts version-controlled.

Do not hide important business rules exclusively inside prompts.

Critical rules belong in application code.

---

# 22. AI Tool Standards

AI tools must be:

- Explicit
- Narrowly scoped
- Validated
- Authorized
- Auditable

Example:

```text
getAvailableAppointmentSlots()
```

is preferred over:

```text
executeDatabaseQuery()
```

The AI should never receive unrestricted database access.

---

# 23. Structured AI Output

When the application needs structured information from AI, use a defined schema.

Example:

```json
{
  "intent": "BOOK_APPOINTMENT",
  "urgency": "NORMAL",
  "serviceType": "AC_REPAIR",
  "readyToBook": true
}
```

Validate AI output before using it.

If validation fails:

- Do not execute the action.
- Retry when appropriate.
- Fall back to a safe response or human handoff.

---

# 24. AI Hallucination Prevention

When the AI does not know something:

It should say so or escalate.

It must not invent an answer.

For example, if pricing is not configured:

> I can help you schedule an appointment. The team can provide pricing after reviewing the issue.

Do not fabricate a price.

---

# 25. HVAC Safety Standards

The AI is not a technician.

It must not:

- Claim to diagnose equipment definitively.
- Claim to have inspected a property.
- Provide dangerous repair instructions.
- Encourage customers to manipulate unsafe equipment.
- Guarantee that a condition is safe.

Potentially dangerous situations should follow the configured escalation policy.

---

# 26. Human Handoff

Human takeover is a first-class feature.

When a staff member takes over:

```text
AI → PAUSED
Human → ACTIVE
```

The system must clearly display:

- Who took over
- When
- Current conversation owner

The AI must not continue sending automated messages while human control is active.

---

# 27. SMS Standards

SMS messages should be:

- Concise
- Clear
- Professional
- Helpful

Avoid unnecessarily long messages.

The system must track:

- Message direction
- Provider message ID
- Delivery status where available
- Timestamp
- Conversation
- Organization

---

# 28. SMS Idempotency

SMS webhooks may be delivered multiple times.

Use provider message IDs or equivalent idempotency keys.

The same incoming message must not be processed twice.

---

# 29. Lead Intake Standards

The lead intake endpoint is public-facing.

It must include:

- Input validation
- Rate limiting
- Abuse prevention
- Idempotency where appropriate
- Duplicate detection
- Logging

Do not block the HTTP request unnecessarily while waiting for the entire AI workflow.

Use asynchronous processing when appropriate.

---

# 30. Appointment Standards

Appointments are business-critical.

Never assume availability.

Always:

1. Query availability.
2. Present a valid slot.
3. Re-check availability before booking.
4. Create the external calendar event.
5. Persist the appointment.
6. Confirm to the customer.

If any critical step fails, do not claim success.

---

# 31. Calendar Double-Booking Prevention

The system must protect against race conditions.

A slot that was available 30 seconds ago may no longer be available.

Use:

- Availability re-checks
- Transactional logic where applicable
- External API error handling
- Idempotency

---

# 32. Integration Standards

External services must be isolated behind service interfaces.

Examples:

```text
SmsProvider
AiProvider
CalendarProvider
```

Business logic should depend on interfaces rather than directly on provider-specific SDK calls wherever practical.

This makes providers replaceable and testing easier.

---

# 33. Google OAuth Standards

OAuth tokens must:

- Be encrypted/protected at rest where appropriate.
- Never be exposed to the frontend unnecessarily.
- Never appear in logs.
- Be revoked when an integration is disconnected.

Handle:

- Expired tokens
- Revoked access
- Missing permissions
- Calendar API failures

---

# 34. UI/UX Standards

The application should be optimized for busy HVAC office staff.

Prioritize:

- Speed
- Clarity
- Search
- Minimal clicks
- Clear statuses
- Action-oriented screens

Primary workflow:

```text
Lead
 ↓
Conversation
 ↓
Qualification
 ↓
Appointment
```

---

# 35. UI Status Standards

Use clear text labels in addition to visual indicators.

Examples:

```text
New
AI Engaged
Waiting for Customer
Qualified
Booked
Human Handoff
Closed
```

Do not communicate important state through color alone.

---

# 36. Loading States

Every asynchronous operation must have a loading state.

Examples:

- Loading leads
- Loading conversation
- Checking availability
- Booking appointment
- Sending message
- Connecting Google Calendar

Prevent duplicate submissions while an action is processing.

---

# 37. Empty States

Every major screen should have a useful empty state.

Example:

```text
No appointments yet.

Once a lead books an appointment, it will appear here.
```

Avoid blank screens.

---

# 38. Error States

Errors should explain:

- What happened
- Whether the action succeeded
- What the user can do next

Example:

```text
Appointment could not be booked.

The selected time is no longer available.
Please choose another time.
```

---

# 39. Accessibility

Follow accessible UI practices.

Requirements include:

- Keyboard navigation
- Proper labels
- Focus management
- Accessible dialogs
- Semantic HTML
- Screen-reader-friendly controls
- Adequate contrast
- Visible focus states

Do not rely solely on color.

---

# 40. Responsive Design

The primary experience is desktop-oriented, but the application should remain usable on smaller screens.

Do not allow critical functionality to become inaccessible on mobile/tablet widths.

---

# 41. Testing Standards

Every important business rule must have automated tests.

Prioritize:

1. Authentication
2. Authorization
3. Tenant isolation
4. Lead intake
5. SMS processing
6. AI actions
7. Appointment booking
8. Calendar integration
9. Human handoff

---

# 42. Test Pyramid

Use a balanced testing strategy.

### Unit Tests

Business logic and utilities.

### Integration Tests

Database and service interactions.

### End-to-End Tests

Critical user workflows.

Do not rely exclusively on end-to-end tests.

---

# 43. Critical End-to-End Test

The following workflow must be covered:

```text
Submit website lead
      ↓
Lead created
      ↓
SMS sent
      ↓
Customer replies
      ↓
AI processes message
      ↓
Customer wants appointment
      ↓
Calendar availability retrieved
      ↓
Customer selects time
      ↓
Calendar booking succeeds
      ↓
Appointment saved
      ↓
Confirmation SMS sent
```

---

# 44. Error Recovery

External systems fail.

Handle:

- AI provider downtime
- SMS provider downtime
- Google Calendar downtime
- Network failures
- Database failures
- Invalid OAuth credentials
- Expired tokens
- Rate limits

Do not silently swallow errors.

Provide appropriate retry or escalation behavior.

---

# 45. Background Jobs

Use background jobs for operations that do not need to block the initial HTTP request.

Potential jobs:

- Send SMS
- Process inbound SMS
- Generate AI response
- Appointment reminders
- Analytics aggregation
- Retry failed external operations

Jobs must be idempotent.

---

# 46. Performance Standards

Optimize for:

- Fast lead creation
- Fast lead search
- Fast conversation loading
- Fast appointment lookup
- Efficient database queries

Avoid unnecessary API calls.

Avoid loading entire message histories when only recent messages are required.

Paginate large datasets.

---

# 47. Database Query Standards

Avoid:

- N+1 queries
- Unbounded queries
- Loading unnecessary columns
- Repeated identical queries

Use appropriate indexes for:

- Organization ID
- Lead status
- Phone
- Email
- Conversation ID
- Appointment date
- Message timestamp

---

# 48. Code Quality

Code should be:

- Readable
- Small enough to understand
- Consistent
- Well named
- Testable

Prefer simple code over clever code.

Avoid premature abstraction.

---

# 49. Comments

Comments should explain **why**, not simply repeat **what** the code does.

Bad:

```typescript
// Get lead
const lead = await getLead(id);
```

Good:

```typescript
// Re-check availability immediately before booking because
// calendar slots may have changed since the AI offered them.
```

---

# 50. Dependency Standards

Before adding a dependency:

- Verify it is actively maintained.
- Check security considerations.
- Check whether the project already has an equivalent.
- Keep dependencies minimal.

Do not add libraries for trivial functionality that can be implemented safely with existing tools.

---

# 51. Git Standards

Use focused commits.

Prefer:

```text
feat: add lead intake endpoint
feat: add SMS conversation handling
feat: add Google Calendar availability
fix: prevent duplicate webhook processing
test: add appointment booking coverage
```

Avoid vague commits such as:

```text
updates
changes
stuff
fixes
```

---

# 52. Pull Request Standards

A pull request should describe:

### What Changed

Short summary.

### Why

Business/technical reason.

### Testing

Tests run and results.

### Risks

Potential side effects.

### Screenshots

Required for significant UI changes where practical.

---

# 53. Documentation Standards

Update documentation when changing:

- APIs
- Environment variables
- Database schema
- Integrations
- User workflows
- Deployment
- Configuration

Primary documentation includes:

```text
README.md
PROJECT.md
STANDARDS.md
```

Keep these documents consistent.

---

# 54. AI Coding Agent Standards

When using Claude Code or another AI coding agent:

The agent must:

1. Inspect the repository before changing architecture.
2. Read `PROJECT.md`.
3. Read `STANDARDS.md`.
4. Follow existing conventions.
5. Make incremental changes.
6. Run tests.
7. Fix failures.
8. Avoid unrelated refactoring.
9. Explain significant architectural decisions.
10. Never claim functionality works without verification.

---

# 55. AI Coding Agent Completion Report

At the end of a task, the coding agent should report:

```text
## Completed
- ...

## Tests
- ...

## Files Changed
- ...

## Database Changes
- ...

## Configuration Changes
- ...

## Known Issues
- ...

## Next Steps
- ...
```

---

# 56. Definition of Production Ready

A feature is not considered production-ready until:

- [ ] Requirements are implemented.
- [ ] Server-side authorization exists.
- [ ] Tenant isolation is verified.
- [ ] Input validation exists.
- [ ] Error states are handled.
- [ ] Loading states are handled.
- [ ] Empty states are handled.
- [ ] Critical tests exist.
- [ ] Logging is appropriate.
- [ ] Sensitive information is protected.
- [ ] Documentation is updated.
- [ ] Production build succeeds.

---

# 57. Non-Negotiable Rules

The following rules must never be violated:

1. **Never expose secrets.**
2. **Never trust client-side authorization.**
3. **Never allow cross-tenant data access.**
4. **Never let AI directly perform unrestricted database operations.**
5. **Never tell a customer an appointment is booked until it actually is.**
6. **Never invent business information.**
7. **Never provide unsafe HVAC repair guidance through the AI.**
8. **Never process duplicate webhooks as separate business events.**
9. **Never deploy untested critical business logic intentionally.**
10. **Never trade customer or business data integrity for implementation speed.**

---

# 58. Guiding Principle

When deciding between two implementations, prefer the one that makes the system:

> **More predictable, more secure, easier to test, and easier for a future engineer to understand.**

The product's primary responsibility is not merely to send AI messages.

Its responsibility is to reliably turn legitimate HVAC website inquiries into qualified, correctly scheduled appointments while keeping customers, staff, and business data safe.