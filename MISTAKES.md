# Mistakes

A running record of things I got wrong on this project: broken builds, bad
calls, and places the user had to correct my approach.

Newest first. Each entry records what happened, why, the fix, and the rule that
would have prevented it.

Three patterns run through this session and are worth reading as groups ratherthan as isolated incidents: 

**secrets leaked by printing unmasked output**,

**suppressed output making a failure look like a success**, 
and 
**treating arecurring symptom as flakiness instead of finding its cause**.

---

## Leaked a secret by building a URL out of it, after saying I would not

**What happened.** I generated the SMS Gate webhook secret, wrote it to `.env`
without printing it, said so - and then printed the assembled webhook URL,
which contains the secret. Third leak on this project.

**Root cause.** I was guarding the *variable*, not the *value*. Reading a secret
back out of a file and concatenating it into something else is printing it; the
string being a URL changes nothing.

**The correct fix.** Rotated it - it had not been configured anywhere yet, so
nothing was at risk - and handed over a command for the user to run locally,
so the assembled URL never entered the transcript.

**Prevention rule.** A value derived from a secret is the secret. Never
construct output from one; print a command that constructs it on the user's
machine instead. This is the same rule as the two earlier leaks, which is why
it is now the third entry rather than a new lesson.

---

## A test that passed in the morning and failed after lunch

**What happened.** The cancellation specs booked an appointment at a fixed
instant (`2026-08-18T12:00Z`, resolving to 14:00Z) while
`findActiveAppointment` filters against the real clock. They passed all
morning. Once the wall clock passed 14:00Z the appointment counted as already
happened, could not be cancelled, and four specs went red - looking like the
SMS Gate work had broken cancellation, which it had not.

**Root cause.** Half the test was on a simulated clock and half on the real one.

**The correct fix.** Book relative to `new Date()` so the resolved slot is
always ahead of now.

**Prevention rule.** If the code under test reads the real clock, the test must
too - or inject the clock into both. A fixed date in one half and `Date.now()`
in the other is a test with an expiry time, and it will fail in CI overnight
looking like a regression in whatever landed last.

---

## Three wrong diagnoses before finding the real one

**What happened.** The suite failed about one run in three. I blamed, in order:
a loaded machine (retracted when containers showed 0% CPU), a per-file
`prisma.$disconnect()`, and vitest's timeout. I changed code for the last two.
None was the cause. The failures landed consistently at **5.1-5.3 seconds** -
which is Prisma's *connection-pool* timeout, not vitest's - and
`getDashboardMetrics` issues five concurrent queries while the whole suite runs
in one fork.

**Root cause of the mistake.** The timing was in every failure line from the
start and I read it as "about five seconds, so probably the timeout" instead of
"exactly the pool timeout, every time". A number that repeats to three
significant figures is a fingerprint, not an approximation.

**The correct fix.** `connection_limit=25` on the test database URL. Two runs in
three failing became one in five.

**Prevention rule.** When a failure recurs at a suspiciously consistent
duration, find out what has a timeout of exactly that length before changing
anything.

---

## Backgrounded a command that backgrounded itself

**What happened.** I ran a Docker build with `nohup ... &` inside a call that
was already backgrounded. The outer command returned instantly with exit 0, the
harness reported success, and the build died with the shell. I only noticed
because the image did not exist twenty minutes later.

**Prevention rule.** Let one layer own the backgrounding. `&` inside a
backgrounded call reports on the wrong process.

---

## A shell loop split filenames on spaces and reported files as missing

**What happened.** Before deleting the duplicated `landing/` folder I checked
every file existed in the other repository. `for f in $(git ls-files)` split
"Firstline Demo v2.dc.html" into three words, so the check reported thirteen
missing files that were all present. Acting on it would have kept the
duplicate.

**Prevention rule.** `while IFS= read -r` over a pipe, never `for` over
`$(...)`, when anything might contain a space. And when a check reports
something surprising, suspect the check first.

---

## Copied a CLI without its dependencies

**What happened.** The Dockerfile copied `node_modules/prisma` so migrations
could run at startup. Its own dependency tree was left behind and the container
died on `MODULE_NOT_FOUND` for `@prisma/config`.

**The correct fix.** Install it in the runner stage, pinned to the *lockfile*
version rather than the `package.json` range - the CLI applying a migration
should be the one that generated the client.

**Prevention rule.** Copying a package out of `node_modules` copies a leaf, not
a tree.

---

## Ignored a warning from my own tooling, and shipped a broken command

**What happened.** I wrote a PowerShell path into `STATUS.md` through a Python
heredoc. Python printed `SyntaxWarning: invalid escape sequence` and I read past
it. Backslash-v became a vertical tab and backslash-r a carriage return, so the
documented command came out as `Claudem_bundles ... claudevm.bundleootfs` -
unrunnable, in the file a new session reads first.

**And then I did it again.** Writing *this entry* through a heredoc ate the same
two escapes, leaving a sentence that read "`` became a vertical tab". The
warning fired that time too, and I missed it twice in one day. Rewritten with a
literal-text editor, which is what the rule below says to do.

**Prevention rule.** A warning from the tool doing the work is evidence, not
noise. And never build Windows paths in a language that interprets backslashes -
use a literal-text editor, or the path will be wrong in a way that reads fine.

---

## `git add -A` swept unverified work into a documentation commit

**What happened.** I staged everything to commit a `STATUS.md` edit. It also
committed the entire unverified Phase 5 booking implementation under a message
saying "docs:".

**The correct fix.** Amended the message to describe what was actually in it,
including that the tests had never run.

**Prevention rule.** Stage deliberately. `-A` in a focused commit takes whatever
else happens to be in the tree.

---

## Called Docker "unstable" for hours instead of checking the disk

**What happened.** Docker's engine returned 500 errors, the Postgres container
dropped mid-test-run twice, and 79 then 47 tests failed. Each time I diagnosed
"Docker is flaky", restarted it, and carried on. The actual cause was C: at
**0 bytes free** — Docker cannot write to a full disk. I only found it when
asked for a time estimate, because the estimating rule forced a machine check.

**Root cause.** I had measured free disk once, during planning, and never again.
A resource that changes continuously was treated as a fixed fact. When the same
failure recurred three times I reached for the familiar explanation instead of
asking what would produce exactly this pattern.

**The correct fix.** Measured the disk, found `vm_bundles` at 10.91 GB and
Docker's image at 8.44 GB, and cleared npm cache and Temp to recover 4.1 GB.

**Prevention rule.** A symptom that recurs is not flakiness, it is an
unexamined cause. And a resource measurement has a shelf life — re-check
before blaming a tool, not once at the start.

---

## Reported a 0-byte file as a database backup

**What happened.** Before proposing a Docker disk migration that could destroy
both projects' volumes, I ran `pg_dump ... 2>/dev/null` and announced the
backup was written. The file was 0 bytes: Docker was down and the dump had
failed. The stderr redirect hid the error.

**Root cause.** I suppressed the channel that would have told me it failed, then
reported success based on the command completing.

**The correct fix.** Deleted the empty file, re-ran without the redirect, saw
the daemon was unreachable, and withdrew the migration recommendation.

**Prevention rule.** Never suppress stderr on an operation whose failure you
would act on. For a backup specifically, assert the artifact — non-zero size,
plausible content — because a backup that does not exist is worse than none:
it converts a known risk into a false sense of safety.

---

## `npm install | tail` reported exit 0 on a failed install

**What happened.** The install died with `ECONNRESET` partway through. The
harness reported exit code 0, because in a pipeline the exit status is `tail`'s,
not npm's. I nearly proceeded as though dependencies were installed.

**Root cause.** Piped a command whose exit code I intended to trust.

**The correct fix.** Re-ran redirecting to a file and captured `$?` directly.

**Prevention rule.** If you care about a command's exit code, do not pipe it.
Same family as the 0-byte backup above: the shell will happily tell you a
failure succeeded if you ask the wrong thing.

---

## Leaked two secrets by printing unmasked output

**What happened.** Twice. First, diagnosing a malformed `.env` line, my masking
only applied to lines containing `=` — the broken line had none, so roughly 25
of 36 characters of the webhook secret printed. Second, I dumped the TextBee
webhooks API response to show its configuration; the response body includes
`signingSecret` in plaintext.

**Root cause.** Both times I wrote the mask for the shape of output I expected,
then printed output of a different shape. The first was a line without `=`; the
second was a field I had not anticipated being in the response at all.

**The correct fix.** Rotated the secret in both `.env` and the TextBee
registration, and switched to printing only structure — key names, value
lengths, match/no-match — rather than values.

**Prevention rule.** Do not mask output, *construct* it. Print key names,
lengths, and booleans; never pass a whole response or file line through a
filter and hope the filter covers every case. A regex that has to be right
about untrusted input will eventually be wrong.

---

## Sent a test message to a phone number I invented

**What happened.** While `SMS_PROVIDER=textbee`, I posted a lead with
`+639171234567` — a number I made up to demonstrate a validation case. Had the
gateway been working, it would have texted whoever owns that number and spent
one of 50 monthly messages.

**Root cause.** I was thinking about the API's response shape and forgot the
request had a real-world side effect. The provider was live at the time and I
did not check before firing.

**The correct fix.** Owned it immediately, and afterwards used only numbers
already in the database or the console provider for demonstrations.

**Prevention rule.** Before any request that can leave the machine, ask what it
does in the real world if it succeeds. Placeholder data is safe in a validation
example and dangerous in a live one.

---

## Ordered the booking check so nobody could book after hours

**What happened.** I placed the booking branch after the after-hours branch, so
a customer texting at 2am asking for a slot received "we'll follow up in the
morning" instead of an appointment. "Increase after-hours bookings" is one of
the PRD's stated success metrics.

**Root cause.** I ordered the branches by when I wrote them rather than by what
each one is for. After-hours exists because open-ended conversation needs a
human; booking needs nobody.

**The correct fix.** Moved booking ahead of after-hours and added a test that
books outside business hours.

**Prevention rule.** In a chain of guards, order by authority, not by history.
Ask what each branch is protecting against, and whether the branch below it is
genuinely subordinate.

---

## Redacted token counts as if they were credentials

**What happened.** The logger scrubbed any key containing `token`, so
`inputTokens` and `outputTokens` logged as `[redacted]` — destroying the cost
visibility that the SMS quota guard depends on.

**Root cause.** A substring match on a word that means two different things.

**The correct fix.** Exact-match rules for real credential keys, plus three
regression tests: credentials scrubbed, counts preserved, ordinary fields
untouched.

**Prevention rule.** Redaction that is too broad fails silently and looks like
success. Test what a filter must *keep*, not only what it must remove.

---

## A test helper clobbered the payload it was supposed to extend

**What happened.** Three opt-out tests failed. The builder spread `...overrides`
after assembling `data`, so an override of one field replaced the whole object
and dropped `sender`; the request 400'd before reaching the code under test.

**Root cause.** Spread order.

**The correct fix.** Destructured `data` out and merged it separately.

**Worse than the failures.** A fourth test was *passing* for the wrong reason:
it asserted "not opted out", which was true because the request never got that
far. It now asserts a 200 first.

**Prevention rule.** When a test fails, check the tests that still pass. A
fixture bug that breaks some assertions is usually silently satisfying others.

---

## Left a stale dev server holding the port with cached configuration

**What happened.** A dev server outlived its task wrapper and kept port 3100.
A new one failed with `EADDRINUSE`, and for a moment I was about to test
against the old process — which held the *previous* `.env` in memory, including
a different AI provider.

**Root cause.** Next reads `.env` once at boot and `getEnv()` caches it, so a
surviving process serves stale configuration indefinitely while looking healthy.

**The correct fix.** Identified the owning PID, stopped it, confirmed the port
was free, then started fresh.

**Prevention rule.** After any `.env` change, verify *which* process is serving,
not just that something is. An old server answering with old config is worse
than no server, because it produces confident wrong results.

---

## Wrote paths that do not exist on Windows

**What happened.** Several commands wrote to `/tmp/...`, which Node resolved to
`D:\tmp` — a directory that does not exist. Two commands failed outright.

**Root cause.** Reflex from a POSIX environment, in a session where the user had
explicitly said they are on Windows.

**The correct fix.** Wrote scratch files into the working directory and deleted
them, or used the session scratchpad.

**Prevention rule.** The user told me the platform. Environment facts stated
once should change behaviour for the rest of the session, not just the next
command.

---

## Asked for decisions the user had already delegated

**What happened.** Early on I twice raised structured questions about stack and
tenancy; both were dismissed. Later the user said plainly: *"I can wait for
another hour as long as you don't ask me for decision-making."*

**Root cause.** I treated reversible choices — framework, model, file layout —
as needing sign-off. They were mine to make and state.

**The correct fix.** Made the calls, recorded the reasoning in `CONTRIBUTING.md`
and commit messages, and reserved questions for things that genuinely could not
be undone, such as a Docker migration risking another project's data.

**Prevention rule.** Ask only when being wrong would be expensive *and*
irreversible. Otherwise decide, say what you decided and why, and move.

---

## Test isolation set at module scope, silently undone by the test runner

**What happened.** Adding Google Calendar meant the booking code reads a real
calendar. `tests/setup.ts` cleared `GOOGLE_CLIENT_EMAIL`, `GOOGLE_PRIVATE_KEY`
and `GOOGLE_CALENDAR_ID` at module scope so the suite would stay offline. It
did not work. Vitest loads `.env` through Vite *after* setup modules are
evaluated, so the real service account was back in `process.env` before the
first test ran. The whole suite made live Calendar API calls against the
business's actual calendar, and its 19 real events filtered offered slots down
to zero.

**Root cause.** The symptom pointed somewhere else entirely. Three specs failed
on availability, which reads as a bug in slot resolution — and I spent four
rounds theorising about `resolveOccurrences`, timezones and the unique
constraint before instrumenting anything. The probe that finally found it
printed one line: `calendarConfigured: true`.

**The correct fix.** Move the isolation into `beforeEach`, which runs after any
env loading, and set empty strings rather than `delete` — empty is what
`env.ts` treats as unset and it survives a reload that a delete does not. Then
`tests/calendar/network-isolation.test.ts` asserts the isolation itself, because
a suite that reaches the network still passes right up until the network or the
calendar's contents change.

**Prevention rule.** Isolation from an external system is a claim to be
asserted, not arranged and assumed. Write the test that proves the tests cannot
reach it. And when a failure looks like domain logic, print the actual state
before theorising about the algorithm — measurement first, hypothesis second.

---

## Leaked a secret again, by redacting one field and dumping the rest

**What happened.** Querying the TextBee API to count webhook subscriptions, I
carefully redacted the API key in the output - then printed the raw JSON
response, which contained `signingSecret` in full. That is
`TEXTBEE_WEBHOOK_SECRET`, the HMAC key authenticating every inbound webhook.
It is now in the session transcript and has to be rotated.

**Root cause.** I redacted the input and not the output. The API key was
something I read from `.env` and knew to hide; the signing secret arrived from
the network inside a blob I echoed without reading first. Redaction was applied
to the field I was thinking about rather than to the channel.

**The correct fix.** Told the user immediately, before reporting any findings,
and gave the rotation steps. The finding the call was made for - one webhook,
not two - was worth having, but it does not offset this.

**Prevention rule.** Never print a raw third-party API response. Select the
fields to display by name and print only those. Anything arriving from a
network call is assumed to carry credentials until each field has been looked
at - and this is the fourth secret leaked in this project, every one of them a
value I had not personally typed.

---

## Inferred a second system rather than asking who was at the keyboard

**What happened.** A booking confirmation arrived on the test phone that this
application had not sent - different wording from the template, absent from the
`Message` table, present in TextBee's Sent log. I concluded another application
was sharing the TextBee account, hunted for a second webhook subscription,
queried the provider's API to enumerate them, and wrote it into `STATUS.md` as
a blocker that made every SMS test untrustworthy.

The user had typed it by hand in the TextBee dashboard's Send form.

**Root cause.** The evidence was read as a technical mystery when it was a
human action, and I never asked the one question that would have settled it in
a sentence. The tell was in the message the whole time: the year read "22026".
Applications do not typo. I noticed the mangled year, quoted it repeatedly as
proof the message was foreign to our template, and did not draw the obvious
conclusion from it.

**The correct fix.** Corrected `STATUS.md`, which had recorded the wrong
diagnosis as a blocker, and dropped the recommendation to rotate the API key -
that key was never the problem.

**Prevention rule.** When something appears that the system did not do, the
first hypothesis is that a person did it, not that a second system exists. Ask.
And treat evidence of human authorship - typos, inconsistent formatting, an
odd hour - as evidence, rather than only as proof of what it is not.

---

## A test double that returned duplicate ids under concurrency

**What happened.** Adding quiet hours turned five retry tests red. They passed
alone, passed in every pair I tried, and failed in the full suite - so I blamed
the new feature twice: first a leaked `BUSINESS_TIMEZONE` putting the suite
inside the quiet window, then the new database column. Both were real problems
and neither was this one.

The actual error was `Unique constraint failed on (providerMessageId)`. The spy
provider returned `` `spy-${sent.length}` `` - reading the array length *before*
pushing. `retryPendingIntroSms` sends concurrently, so two sends could both read
the same length and hand back the same id.

**Root cause.** The double was not faithful to the thing it stood in for. A real
gateway never returns the same message id twice; this one did, given the right
interleaving. The bug had been latent for as long as the double existed, and a
new test file changed the scheduling enough to surface it.

**The correct fix.** A counter incremented on each call, never reset, as a real
provider's ids behave. The three doubles in that file now share it.

**Prevention rule.** A test double must hold the invariants of the real thing,
not merely its shape - unique ids stay unique, monotonic clocks stay monotonic.
And when a test passes alone but fails in the suite, read the error before
forming a theory: "my new feature broke it" is a hypothesis, and the exception
text was naming a different culprit the whole time.
