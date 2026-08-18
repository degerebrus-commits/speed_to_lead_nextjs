# What we need from you to go live

Everything on the software side is built and tested. What is left is a set of
things only you can provide, because they involve your business identity, your
accounts, and your website.

**Please read section 1 first.** It is short, and the answers decide whether
this takes an afternoon or two weeks.

---

## 1. Three questions about your existing text number

You may already have a Twilio phone number for another system. If you do, we
may be able to reuse most of the setup and skip the longest wait in this
project.

### Q1. Do you already send business text messages through Twilio?

- **Yes** — please tell us, this is good news and likely saves one to two weeks.
- **No** — we will set one up. Costs about a dollar a month plus a fraction of
  a cent per text.
- **Not sure** — tell us what system sends your texts today and we will work it
  out.

### Q2. Is another system already receiving replies to that number?

For example a CRM, an answering service, or a scheduling tool that shows you
incoming texts.

This matters because a phone number can only deliver incoming texts to **one**
system. If your CRM currently receives them and we point the number at the
assistant instead, your CRM stops receiving them — quietly, with no error.

**If the answer is yes, we will simply add a second number for the assistant.**
It costs about a dollar a month, nothing about your current setup changes, and
it is the safer arrangement anyway: the assistant's conversations stay separate
from your existing ones.

### Q3. What kind of number is it?

- A normal local number, like (702) 555-0142
- A toll-free number, starting 800 / 833 / 844 / 855 / 866 / 877 / 888
- A short code, which is 5 or 6 digits

Each takes a different approval route, so we need to know before we plan.

---

## 2. Registration with the phone carriers

US carriers require any business sending automated texts to be registered
before those texts will be delivered. This is called **A2P 10DLC**. It is not
optional, and it is the single longest step in the project — **one to two
weeks** if you are starting fresh.

Until it is approved, the assistant can only text our own test phone. It cannot
text your customers.

### What the registration needs from you

| Item | Notes |
|---|---|
| Legal business name | Exactly as registered, not the trading name |
| EIN | Federal tax ID |
| Business address | The registered address |
| Website URL | Must be live, and must show the consent language in section 3 |
| Contact name, email, phone | A person the carriers can reach |

If you answered **yes** to Q1, your business is probably already registered.
That is the slow part, and it carries over — we would only need to add the
assistant, which is much quicker.

---

## 3. The consent line for your web form

**This is required, and the registration will be rejected without it.**

Your lead form must show this text near the submit button, with a tick box the
customer actively checks. It must not be pre-ticked.

> By submitting this form and signing up for texts, you consent to receive text
> messages from **[your business name]** at the number provided, including
> messages sent by the auto dialer. Consent is not a condition of purchase. Msg
> & data rates may apply. Msg frequency varies. Unsubscribe at any time by
> replying STOP to **[your number]**, and no further messages will be sent.
> Reply HELP for help. See Privacy Policy & Terms.

Replace the two bracketed parts with your business name and the number the
assistant will text from.

**Why it is not just paperwork.** The assistant records who agreed and when,
and it will not text anyone whose form did not carry that tick. A lead who
arrives without it is still saved and shown to you with a note to phone them
instead — you do not lose the customer, but the automatic text is held.

Your website also needs a privacy policy that mentions text messaging, linked
from that form.

---

## 4. Accounts and keys

Send these securely — a password manager share, or over the phone. **Not email
or chat.**

| What | Where to find it |
|---|---|
| Twilio Account SID | Twilio Console home page |
| Twilio Auth Token | Same page, click to reveal |
| Your Twilio number | Written as +17025550142 |
| Google Calendar ID | Only if you want appointments written to a calendar. In that calendar's settings |

---

## 5. How the assistant should behave

These shape what your customers actually read. Where you have no strong
preference, say so and we will use a sensible default.

**Identity**

- The business name exactly as it should appear in texts, e.g. "Comfort Pro
  Heating and Air"
- The first name the texts come from, e.g. "Dustin" — customers reply to a
  person, not a company
- A phone number a customer can call to reach a human

**Hours and coverage**

- Your time zone
- Opening hours, and which days
- Your service area — towns or ZIP codes, so the assistant can flag anything
  outside it

**Appointments**

- How long a visit takes, e.g. 90 minutes
- The time slots you want offered, e.g. "Tue 8am-10am", "Tue 1pm-3pm"
- How many visits can run at the same time

**Qualifying**

- The questions the assistant must ask before booking — the problem, how
  urgent, the address, anything else
- What counts as an **emergency**, in your words: gas smell, no heat in
  freezing weather, water leak, and so on
- What should happen when one is detected — who gets called, at what number

**Message wording**

- The first text that goes out seconds after a form submission
- The booking confirmation text
- Whether the assistant should still reply overnight, or wait until morning.
  We recommend replying — the customer is awake and expects an answer

---

## What happens after you send this back

1. We connect your account and configure the assistant with your wording — same day
2. You add the consent line to your form — your web person, usually under an hour
3. We submit the carrier registration — same day, then the wait begins
4. Carrier approval — **one to two weeks**, or much faster if you were already registered
5. We test end to end against your own phone
6. Live

**Steps 2 and 3 are the critical path.** Everything else can happen while the
registration is in review, so the sooner the consent line is live and the
registration submitted, the sooner this goes live.

The single most useful thing you can do today is answer the three questions in
section 1.
