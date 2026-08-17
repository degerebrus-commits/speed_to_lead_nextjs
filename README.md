# AI Lead Response & Appointment Booking Assistant for HVAC Service Businesses

AI-powered SaaS platform that automatically responds to HVAC website leads via SMS, qualifies their needs through an AI conversation, and helps convert qualified leads into booked appointments through Google Calendar.

> **Status:** MVP / Active Development

---

## Overview

HVAC businesses often lose leads because inquiries are not answered quickly enough.

This platform acts as an AI-powered lead response and scheduling assistant.

When a potential customer submits a website form:

```text
Website Lead
     ↓
Lead Created
     ↓
Immediate SMS
     ↓
AI Conversation
     ↓
HVAC Lead Qualification
     ↓
Appointment Availability
     ↓
Customer Selects Time
     ↓
Google Calendar Booking
     ↓
SMS Confirmation
```

The system also allows staff to take over conversations whenever human assistance is required.

---

## Core Features

### Lead Management

- Website lead intake
- Lead profiles
- Lead status tracking
- Lead search and filtering
- Lead source tracking
- Lead assignment

### AI SMS Conversations

- Automatic first response
- Natural conversational qualification
- Conversation history
- Context-aware responses
- Booking intent detection
- Human handoff
- Configurable AI behavior

### HVAC Qualification

The AI can collect information such as:

- HVAC issue
- Heating or cooling problem
- Urgency
- Property type
- Service address
- Customer availability
- Existing customer status

The qualification flow is conversational rather than a rigid questionnaire.

### Appointment Booking

- Google Calendar integration
- Availability lookup
- Appointment duration
- Business hours
- Appointment creation
- Rescheduling
- Cancellation
- Booking confirmation via SMS
- Double-booking prevention

### Business Configuration

Each HVAC business can configure:

- Company information
- Services
- Service areas
- Business hours
- Booking rules
- FAQs
- Cancellation policy
- Emergency escalation policy
- AI personality and instructions

### Dashboard & Analytics

Track:

- New leads
- Response time
- Active conversations
- Qualified leads
- Appointments booked
- Lead-to-booking conversion
- Human handoffs
- Appointment activity

---

## User Roles

### Owner

Full access to the organization.

### Admin

Operational and configuration access.

### Staff

Access to leads, conversations, appointments, and permitted operational functions.

All permissions are enforced server-side.

---

# Getting Started

## Prerequisites

Install the following before starting:

- Node.js
- npm, pnpm, or the package manager used by this project
- Git
- PostgreSQL or the configured database
- An AI provider API key
- An SMS provider account
- A Google Cloud project with Calendar API enabled

> If the repository already specifies exact versions, use those versions instead of the generic prerequisites above.

---

# Installation

Clone the repository:

```bash
git clone <repository-url>
cd <repository-directory>
```

Install dependencies:

```bash
npm install
```

If this project uses another package manager, use the corresponding command.

---

# Environment Variables

Create a local environment file:

```bash
cp .env.example .env
```

Configure the required environment variables.

Example:

```env
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

Do not commit `.env` or production credentials to source control.

---

# Database Setup

Run the project's database migrations:

```bash
npm run db:migrate
```

Seed development data:

```bash
npm run db:seed
```

If the project uses different migration commands, follow the database scripts defined in `package.json`.

---

# Run Locally

Start the development server:

```bash
npm run dev
```

Open the application at:

```text
http://localhost:3000
```

The actual port may differ depending on the project configuration.

---

# Development Seed Data

The development environment should include example data for testing.

Expected seed data:

- One HVAC organization
- Owner account
- Admin account
- Staff account
- Example HVAC leads
- Example conversations
- Example appointments
- Example AI configuration
- Example knowledge-base entries

Example development scenarios:

### AC Not Cooling

```text
"My AC is running but the house isn't getting cool."
```

### Furnace Problem

```text
"My furnace isn't heating the house."
```

### Maintenance

```text
"I'd like to schedule HVAC maintenance."
```

### Replacement Inquiry

```text
"I think I need a new AC system. Can someone give me an estimate?"
```

Development credentials should be documented separately from production credentials and should never contain real customer information.

---

# Architecture

The platform is organized around several major components:

```text
                    ┌────────────────────┐
                    │   HVAC Website     │
                    └─────────┬──────────┘
                              │
                              ▼
                    ┌────────────────────┐
                    │    Lead API        │
                    └─────────┬──────────┘
                              │
                              ▼
                    ┌────────────────────┐
                    │   Lead Database    │
                    └─────────┬──────────┘
                              │
                              ▼
                    ┌────────────────────┐
                    │   SMS Service      │
                    └─────────┬──────────┘
                              │
                              ▼
                    ┌────────────────────┐
                    │   AI Conversation  │
                    │      Engine        │
                    └──────┬─────┬───────┘
                           │     │
                 ┌─────────┘     └──────────┐
                 ▼                          ▼
        ┌────────────────┐         ┌─────────────────┐
        │ Knowledge Base │         │ Calendar Service│
        └────────────────┘         └────────┬────────┘
                                            │
                                            ▼
                                    ┌─────────────────┐
                                    │ Google Calendar │
                                    └─────────────────┘
```

---

# Core Data Model

The application should support the following core entities:

```text
Organization
    ├── Users
    ├── Leads
    ├── Conversations
    ├── AI Configuration
    ├── Knowledge Items
    ├── Appointments
    ├── Calendar Integrations
    └── Audit Logs
```

Every organization must have isolated data.

A user belonging to one organization must never be able to access another organization's data.

---

# Lead Lifecycle

A lead can move through states such as:

```text
NEW
 ↓
CONTACTED
 ↓
ENGAGED
 ↓
QUALIFIED
 ↓
APPOINTMENT_PENDING
 ↓
BOOKED
```

Alternative outcomes include:

```text
HUMAN_HANDOFF
NOT_QUALIFIED
LOST
CLOSED
```

The system should record meaningful status changes in the audit history.

---

# Conversation Lifecycle

A conversation can move through:

```text
INITIAL
   ↓
QUALIFYING
   ↓
ANSWERING_QUESTION
   ↓
READY_TO_BOOK
   ↓
BOOKING
   ↓
BOOKED
```

Human intervention:

```text
ANY STATE
   ↓
HUMAN_HANDOFF
```

The AI must stop automatically sending messages while a human has control of the conversation.

---

# Appointment Workflow

The booking workflow is:

```text
Customer wants appointment
          ↓
Check Google Calendar
          ↓
Find available slots
          ↓
Offer available times
          ↓
Customer selects time
          ↓
Re-check availability
          ↓
Create calendar event
          ↓
Save appointment
          ↓
Send SMS confirmation
```

The system must never tell a customer that an appointment has been booked until the calendar event has successfully been created.

---

# AI Safety & Reliability

The AI is a scheduling and lead-qualification assistant, not an HVAC technician.

The AI should:

- Ask relevant questions.
- Use configured business information.
- Help customers schedule appointments.
- Escalate uncertain situations.
- Follow configured emergency policies.

The AI should not:

- Pretend to have inspected equipment.
- Invent company policies.
- Invent appointment availability.
- Guarantee pricing unless explicitly configured.
- Provide unsafe repair instructions.
- Claim an appointment is booked before successful calendar confirmation.

AI actions must use controlled server-side tools.

Example:

```text
AI Intent
    ↓
Structured Action
    ↓
Server Validation
    ↓
Tool Execution
    ↓
Result
    ↓
AI Response
```

The AI must not have unrestricted database access.

---

# Integrations

## SMS

The application should use an SMS provider abstraction.

Typical provider:

- Twilio

The integration should support:

- Outbound SMS
- Inbound SMS
- Webhook validation
- Delivery status where supported

---

## Google Calendar

Google Calendar integration should support:

- OAuth authentication
- Calendar selection
- Availability lookup
- Event creation
- Event updates
- Event cancellation

Google OAuth credentials must be stored securely.

---

## AI Provider

The AI provider should be isolated behind an application service layer.

This makes it possible to change providers without rewriting the application's core business logic.

---

# Webhook Handling

Public webhooks must be treated as untrusted input.

The application should implement:

- Signature verification
- Request validation
- Idempotency
- Rate limiting
- Duplicate event detection
- Error handling

Repeated webhook delivery must not create duplicate:

- Leads
- Messages
- Appointments

---

# Security

Security requirements include:

- Secure authentication
- Server-side authorization
- Multi-tenant data isolation
- Secure OAuth token storage
- Input validation
- Rate limiting
- HTTPS in production
- Audit logging
- Environment-based secrets

Never commit:

```text
.env
API keys
OAuth secrets
Database passwords
Production credentials
```

to source control.

---

# Testing

Run the test suite with:

```bash
npm test
```

If the project supports separate test types:

```bash
npm run test:unit
npm run test:integration
npm run test:e2e
```

Tests should cover at least:

### Lead Intake

- Valid lead
- Invalid lead
- Duplicate webhook
- Lead creation

### SMS

- Outbound message
- Inbound message
- Duplicate message
- Provider failure

### AI

- Qualification
- Booking intent
- Human handoff
- Tool validation

### Calendar

- Availability
- Appointment creation
- Double-booking prevention
- Rescheduling
- Cancellation

### Multi-Tenancy

- Tenant isolation
- Unauthorized resource access

### Authorization

- Owner permissions
- Admin permissions
- Staff permissions

---

# Development Workflow

Build features in vertical slices.

Recommended sequence:

## Phase 1 — Foundation

- Project setup
- Database
- Authentication
- Multi-tenancy
- Authorization
- Application shell

## Phase 2 — Leads

- Lead API
- Lead database
- Lead list
- Lead detail
- Search and filtering

## Phase 3 — SMS

- SMS provider
- Outbound messages
- Inbound webhook
- Conversations

## Phase 4 — AI

- AI provider
- Conversation state
- Qualification
- Controlled AI tools
- Human takeover

## Phase 5 — Calendar

- Google OAuth
- Calendar connection
- Availability
- Booking
- Rescheduling
- Cancellation

## Phase 6 — Analytics

- Dashboard
- Conversion metrics
- Response metrics
- Booking metrics

## Phase 7 — Production Hardening

- Security
- Testing
- Error handling
- Rate limiting
- Webhook idempotency
- Accessibility
- Performance
- Monitoring

---

# Project Structure

A recommended high-level structure:

```text
src/
├── app/
│   ├── dashboard/
│   ├── leads/
│   ├── conversations/
│   ├── appointments/
│   ├── analytics/
│   ├── settings/
│   └── integrations/
│
├── components/
│   ├── ui/
│   ├── leads/
│   ├── conversations/
│   ├── appointments/
│   └── dashboard/
│
├── server/
│   ├── auth/
│   ├── leads/
│   ├── conversations/
│   ├── appointments/
│   ├── ai/
│   ├── sms/
│   ├── calendar/
│   └── analytics/
│
├── db/
│   ├── schema/
│   ├── migrations/
│   └── seed/
│
└── lib/
    ├── validation/
    ├── permissions/
    ├── logging/
    └── utilities/
```

Adapt this structure to the framework already used by the repository.

Do not create unnecessary folders simply to match this example.

---

# Important API Workflows

## Create Lead

```http
POST /api/leads
```

Creates a lead and triggers the initial engagement workflow.

---

## Receive SMS

```http
POST /api/webhooks/sms
```

Receives an inbound customer message.

---

## Get Availability

```http
GET /api/appointments/availability
```

Returns available appointment slots.

---

## Create Appointment

```http
POST /api/appointments
```

Creates an appointment after server-side validation.

---

## Google OAuth

```text
GET /api/integrations/google/connect
GET /api/integrations/google/callback
```

Handles Google Calendar authorization.

---

# Environment Setup for Integrations

## Google Calendar

Create a Google Cloud project and enable:

```text
Google Calendar API
```

Configure OAuth credentials and the appropriate redirect URL.

Store:

```env
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=
```

Never expose the client secret to the browser.

---

## SMS Provider

Configure the selected SMS provider.

Example environment variables:

```env
SMS_PROVIDER=
SMS_ACCOUNT_ID=
SMS_AUTH_TOKEN=
SMS_PHONE_NUMBER=
```

Use the provider's webhook URL for incoming SMS messages.

---

## AI Provider

Configure the selected AI provider:

```env
AI_PROVIDER=
AI_API_KEY=
```

Keep provider-specific implementation inside the AI service layer.

---

# Local Development

Start the application:

```bash
npm run dev
```

Run database migrations:

```bash
npm run db:migrate
```

Seed the development database:

```bash
npm run db:seed
```

Run tests:

```bash
npm test
```

Run linting:

```bash
npm run lint
```

Build the application:

```bash
npm run build
```

Use the actual scripts defined in `package.json` if they differ.

---

# Production Checklist

Before deploying to production:

- [ ] Configure production database
- [ ] Configure authentication secrets
- [ ] Configure AI provider
- [ ] Configure SMS provider
- [ ] Configure Google OAuth
- [ ] Configure production webhook URLs
- [ ] Enable HTTPS
- [ ] Configure rate limiting
- [ ] Verify tenant isolation
- [ ] Verify authorization
- [ ] Run database migrations
- [ ] Run automated tests
- [ ] Run production build
- [ ] Configure logging/monitoring
- [ ] Verify backups
- [ ] Verify error handling
- [ ] Verify SMS webhook signatures
- [ ] Verify Google OAuth configuration
- [ ] Remove development seed data if appropriate

---

# MVP Definition of Done

The MVP is considered functional when the complete workflow works with persistent data:

```text
Website visitor
      ↓
Submits HVAC form
      ↓
Lead created
      ↓
SMS sent automatically
      ↓
Customer replies
      ↓
AI responds
      ↓
AI qualifies lead
      ↓
Customer requests appointment
      ↓
Google Calendar availability checked
      ↓
AI offers available times
      ↓
Customer selects time
      ↓
Availability re-checked
      ↓
Calendar event created
      ↓
Appointment saved
      ↓
Confirmation SMS sent
      ↓
Dashboard updated
```

A staff member must also be able to take over the conversation at any point.

---

# Roadmap

## Phase 2

Potential additions:

- Automated follow-up sequences
- Email notifications
- WhatsApp
- CRM integrations
- Advanced analytics
- More sophisticated lead scoring
- Customer self-service appointment management

## Phase 3

Potential additions:

- AI voice receptionist
- Inbound phone calls
- Technician dispatching
- Automated quoting
- Service management integrations
- Multi-location management
- Customer portal

---

# Product Success Metrics

The primary metrics are:

### Response Time

How quickly a new website lead receives the first response.

### Lead-to-Booking Conversion

```text
Booked Appointments / Total Leads
```

### Qualification Rate

```text
Qualified Leads / Total Leads
```

### Human Handoff Rate

```text
Human Handoffs / AI Conversations
```

### AI Booking Rate

```text
AI-Booked Appointments / Total Appointments
```

### After-Hours Booking Rate

Measure appointments generated outside normal office hours.

---

# Contributing

Before submitting changes:

1. Follow the existing project architecture.
2. Add tests for new business logic.
3. Run linting.
4. Run the test suite.
5. Verify database migrations.
6. Verify authorization.
7. Verify tenant isolation.
8. Update documentation when behavior changes.

Avoid unrelated refactoring in feature pull requests.

---

# License

Add the project's chosen license here.

---

# Disclaimer

This application is designed to assist HVAC businesses with lead response, qualification, communication, and appointment scheduling.

It should not be treated as a substitute for qualified HVAC technicians or emergency services. AI responses should be constrained by the business's configured policies and appropriate safety rules.