# Prompt for Claude Design — "Try it live" demo form

Paste everything below the line into Claude Design.

---

Build a single, self-contained "Try it live" lead-capture form for a landing
page. A visitor fills it in with their own mobile number and receives a real
text message from an AI booking assistant within seconds, then can reply to it
and have a conversation.

## What it must do

The form posts JSON to an endpoint and shows the result. That is the whole
interaction — no routing, no multi-step wizard, no account.

**Endpoint:** `POST /api/demo/lead`
Set the base URL as a constant at the top of the file so it can be pointed at
localhost or production without hunting through the code.

**Request body** — exactly these keys, exactly these names:

```json
{
  "name": "John Carter",
  "phone": "+15551234567",
  "email": "john@example.com",
  "serviceAddress": "42 Oak Street, Austin, TX",
  "message": "My AC is running but the house is not getting cool.",
  "smsConsent": true,
  "smsConsentText": "<the full disclosure paragraph shown to the user>"
}
```

- `email` is the only optional field. Omit the key or send `""` if blank.
- `smsConsent` is a boolean.
- `smsConsentText` must be the exact wording the visitor saw, sent verbatim.
  The server stores it as the record of what was agreed to.
- No API key, token or secret. The endpoint takes none — do not invent one.

**Responses to handle:**

| Status | Body | Show the visitor |
|---|---|---|
| `200` | `{"status":"sent","message":"..."}` | Success: "Check your phone." Invite them to reply to the text. |
| `200` | `{"status":"held","reason":"no-consent"}` | "Saved, but nothing was sent — consent was not given." |
| `200` | `{"status":"held","reason":"quota-exhausted"}` | "This demo has used its text allowance. Try again later." |
| `400` | `{"error":{"code":"VALIDATION_FAILED","message":"...","fields":["phone"]}}` | Show `message`, and highlight the named fields. |
| `429` | `{"error":{"code":"RATE_LIMITED","message":"..."}}` | "Too many demos right now — try again shortly." |
| network failure | — | "Could not reach the assistant. Check your connection." |

Note that `held` comes back as **200, not an error**. It means the lead was
saved but no text went out, and the reason matters — do not render it as a
failure.

## The consent control — the important part

This is a legal requirement, not a design flourish. US carrier rules require
proof that the person agreed before an automated text is sent, and the system
will refuse to send without it.

Build it as a **prominent CTA-style consent button**, not a small tickbox
buried in fine print:

- A large, full-width control the visitor actively presses, labelled
  **"I agree — text me"**
- It must **start in the un-agreed state**. Never pre-selected, never
  pre-checked, never defaulted on.
- Pressing it visibly changes state — filled background, a check mark, clear
  colour change — so it is obvious whether consent has been given
- The **submit button stays disabled** until it has been pressed, with helper
  text explaining why: "Agree to messaging to continue"
- Pressing it again undoes it
- The disclosure paragraph sits directly above or beside it and is fully
  readable — not collapsed, not behind a "read more", not in 9px grey

Use exactly this disclosure text, with `{{BUSINESS_NAME}}` as a placeholder to
be filled in:

> By submitting this form and signing up for texts, you consent to receive text
> messages from {{BUSINESS_NAME}} at the number provided, including messages
> sent by the auto dialer. Consent is not a condition of purchase. Msg & data
> rates may apply. Msg frequency varies. Unsubscribe at any time by replying
> STOP, and no further messages will be sent. Reply HELP for help.

Send that same string as `smsConsentText`.

## Fields

| Label | Key | Type | Placeholder | Notes |
|---|---|---|---|---|
| Your name | `name` | text | `John Carter` | Required, max 120 |
| Mobile number | `phone` | tel | `+1 512 555 0188` | Required. Helper text: "The assistant will text this number." |
| Email | `email` | email | `john@example.com` | Optional — label it so |
| Service address | `serviceAddress` | text | `42 Oak Street, Austin TX` | Required. Helper: "Anything will do for a demo." |
| What's the problem? | `message` | textarea, 3 rows | — | Required, max 2000. **Pre-filled as a real value**, not a placeholder: "My AC is running but the house is not getting cool." |

**Placeholders are scaffolding, and they earn their place.** A label says what
the field is; a placeholder shows what a good answer looks like, which is what
actually removes hesitation. Every field except the message gets one, and none
of them is ever a real value - an empty field must submit as empty.

The message field is the exception in the other direction: it carries an actual
pre-filled value. Inventing a plausible HVAC fault is the one thing a visitor
cannot do quickly, and this is a demo rather than a service request - so that
work is removed entirely rather than merely guided.

## Behaviour

- Disable the submit button and show a spinner while the request is in flight.
  A double submit creates two leads and sends two texts.
- Keep what the visitor typed on an error. Never clear the form on failure.
- On success, replace the form with the success state rather than leaving a
  filled form sitting there.
- Validate `phone` loosely on the client (digits, spaces, `+`, `-`, brackets;
  at least 7 digits) and let the server do the real check. Do not attempt
  strict E.164 parsing in the browser.

**One reset control, because this form is used by more than one person.** It
sits on a public landing page — at a trade stand, or passed around a laptop — so
the next visitor must not inherit the last one's name and phone number, or
worse, be able to submit them again.

- A single **"Start over"** control in the **upper right of the form card**,
  quiet rather than prominent: it must not compete with the submit button.
- It clears every field, resets the consent control to un-agreed, clears any
  error and status message, and returns the message field to its pre-filled
  default.
- **Always visible — including in the success state**, where it is what the
  next person presses. One control that handles every case; do not add a
  separate "send another" button.
- It must never submit anything. Its only job is to empty the form.

Note the deliberate asymmetry: the form clears itself on **success**, but never
on **failure**. Someone who mistyped their number must get it back to correct,
not have to retype everything.

## Tone and content

The visitor is an HVAC business owner evaluating the product, not a customer
with a broken air conditioner. Frame it as *"see what your customers would
experience."*

Above the form, three short lines of context:

1. **Fill this in with your own number**
2. **You will get a text in seconds** — the same one a new lead receives
3. **Reply to it** — the assistant will answer, qualify the job, and offer
   appointment times

Set expectations honestly: it sends one real SMS, the number is stored, and
replying STOP ends it.

## Look

Clean, professional, trustworthy — a trade-services SaaS, not a consumer app.
Restrained palette, one accent colour, generous whitespace, real hierarchy.

- Works down to 360px wide; single column on mobile
- Light and dark mode, driven by `prefers-color-scheme`
- Proper `<label for>` on every input, visible focus rings, errors announced
  with `role="alert"`, and never colour alone to signal state
- Self-contained: inline CSS and JS, no external fonts, no CDN, no build step.
  It must run by opening the file.

Do not add a testimonial section, pricing table, feature grid, or footer. This
is one form on a page and nothing else.
