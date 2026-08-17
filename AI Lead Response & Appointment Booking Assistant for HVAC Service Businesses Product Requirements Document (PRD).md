# Product Requirements Document (PRD)

# AI Lead Response & Appointment Booking Assistant for HVAC Service Businesses

## Version
1.0

## Overview

The product is an AI-powered lead engagement platform designed for HVAC service businesses. Its primary purpose is to automatically respond to new website leads via SMS, qualify their service needs, answer common questions, and schedule appointments directly into Google Calendar without requiring manual staff intervention.

The system aims to reduce lead response time from minutes or hours to seconds, increasing appointment booking rates while reducing administrative workload.

---

# Problem Statement

HVAC companies receive leads through their websites, but many fail to respond quickly enough.

Common challenges include:

- Slow response times
- Missed opportunities outside business hours
- Staff spending significant time texting leads
- Low conversion from website inquiry to scheduled appointment
- Inconsistent customer communication

Businesses need an automated system that engages every lead immediately and guides them toward booking an appointment.

---

# Goals

### Primary Goal

Automatically convert website leads into booked appointments.

### Success Metrics

- Response initiated within 30 seconds
- Increase lead-to-booking conversion rate
- Reduce manual texting by office staff
- Increase after-hours appointment bookings
- Improve customer response rate

---

# Target Users

## Primary Users

HVAC service businesses

Examples include:

- Residential HVAC contractors
- Air conditioning repair companies
- Heating service companies
- HVAC installation businesses

## Secondary Users

- Office administrators
- Dispatchers
- Business owners

---

# User Journey

### Step 1

Visitor submits a website form requesting HVAC service.

### Step 2

The AI receives the lead instantly.

### Step 3

AI sends an SMS introducing itself and acknowledging the request.

Example:

> Hi John! Thanks for contacting ABC HVAC. I'm here to help. Can you tell me a little about the issue you're experiencing?

### Step 4

AI asks qualifying questions.

Examples:

- Is your AC not cooling?
- Is your heater not working?
- Is this an emergency?
- When did the issue start?
- What city are you located in?

### Step 5

AI answers common customer questions, such as:

- Service areas
- Appointment availability
- General service information
- Basic pricing guidance (if configured)
- Emergency availability

### Step 6

AI identifies an available appointment.

### Step 7

AI confirms the appointment.

### Step 8

Appointment is added automatically to Google Calendar.

### Step 9

Customer receives confirmation via SMS.

---

# Functional Requirements

## Lead Capture

- Receive new website form submissions
- Store lead information
- Trigger AI conversation immediately

Lead information includes:

- Name
- Phone number
- Email (optional)
- Service address
- Initial message

---

## AI SMS Conversation

The AI should:

- Respond instantly
- Use natural conversational language
- Remember conversation context
- Ask follow-up questions
- Handle multiple conversation turns
- Keep responses concise and friendly

---

## Lead Qualification

Collect:

- HVAC issue
- Urgency
- Property type (if needed)
- Preferred appointment time
- Address or service area
- Additional notes

---

## Appointment Scheduling

Integrate with Google Calendar.

Capabilities:

- Check availability
- Offer available time slots
- Confirm selected time
- Prevent double-booking
- Create calendar event
- Send confirmation SMS

---

## Conversation Management

The AI should:

- Detect customer intent
- Handle delays in replies
- Continue conversations after interruptions
- Recognize booking intent
- Recognize cancellation requests
- Recognize reschedule requests

---

## Business Rules

Examples:

- Only offer available appointment slots.
- Respect configured business hours.
- Route emergency situations according to business-defined rules.
- Escalate conversations when confidence is low or when requested by the customer.
- Allow staff to take over conversations at any time.

---

# Non-Functional Requirements

## Performance

- Initial SMS within 30 seconds
- Fast conversation responses
- High system availability

## Security

- Secure storage of customer information
- Encrypted data in transit
- Role-based access for staff
- Audit logging for key actions

---

# Integrations

## Website

Receive lead forms.

## SMS Provider

Send and receive SMS messages.

Potential providers:

- Twilio
- MessageBird
- Other supported SMS APIs

## Google Calendar

- Read availability
- Create appointments
- Update appointments
- Cancel appointments

---

# Admin Dashboard

Business owners should be able to:

- View leads
- View conversations
- Monitor bookings
- Edit AI instructions
- Configure business hours
- Configure appointment durations
- Manage staff calendars
- View analytics

---

# Analytics

Track:

- Total leads
- Response time
- Booking rate
- Conversation completion rate
- Missed opportunities
- Appointment volume
- AI handoff rate
- Customer response rate

---

# MVP Scope

Included:

- Website lead capture
- AI SMS conversations
- Lead qualification
- Google Calendar booking
- Appointment confirmation
- Basic admin dashboard
- Conversation history

Excluded (Future Releases):

- Voice AI
- CRM integrations
- Email automation
- Payment collection
- Multi-location optimization
- Technician dispatching
- Marketing automation

---

# Future Enhancements

- AI voice answering
- Multi-language conversations
- CRM integrations (HubSpot, Salesforce, ServiceTitan, Housecall Pro)
- Automated follow-up campaigns
- Review requests after completed jobs
- Quote generation
- Technician assignment
- AI upsell recommendations
- Knowledge base customization
- Multi-location support

---

# Acceptance Criteria

- Website leads automatically trigger an AI SMS conversation.
- AI qualifies leads through a natural conversation.
- AI successfully books available appointments in Google Calendar.
- Customers receive booking confirmations via SMS.
- Staff can review conversations and appointments through the dashboard.
- The system prevents conflicting appointments and supports human takeover when necessary.

---

# Success Metrics

- 90%+ of new leads receive an SMS within 30 seconds.
- Increase lead-to-appointment conversion rate versus the current process.
- Reduce manual administrative effort spent on lead follow-up.
- Improve after-hours booking volume.
- Maintain high customer satisfaction with AI interactions.