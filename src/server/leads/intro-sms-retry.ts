import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { SmsSuppressedError, sendIntroSms } from "@/server/sms/sms-service";

/**
 * Bounded by default so a single run cannot spend an entire month's SMS quota
 * or hold a request open indefinitely (STANDARDS.md 47 - no unbounded queries).
 */
const DEFAULT_BATCH_LIMIT = 25;

export interface RetryOutcome {
  /** Leads considered in this run. */
  attempted: number;
  /** Intro messages actually delivered to a provider. */
  sent: number;
  /** Deliberately not sent - opted out. Not a failure. */
  skipped: number;
  /** Provider or database errors. Left pending for the next run. */
  failed: number;
  /** True when the run stopped early because the monthly cap was reached. */
  quotaExhausted: boolean;
}

/**
 * Sends the introductory message to leads that never received one.
 *
 * `Lead.introSmsSentAt IS NULL` was designed as the work queue for exactly
 * this, and until now nothing drained it: a lead whose send failed - because
 * the gateway was misconfigured, offline, or rejecting the API key - stayed
 * unreachable forever, since re-posting the same form data collides on the
 * dedupe key and returns `duplicate` without sending.
 *
 * Deliberately sequential rather than parallel. These calls cost money and
 * hit a rate-limited third party; a burst of concurrent sends would trade a
 * few seconds of wall clock for a much worse failure mode.
 */
export async function retryPendingIntroSms(
  limit: number = DEFAULT_BATCH_LIMIT,
): Promise<RetryOutcome> {
  const pending = await prisma.lead.findMany({
    where: {
      introSmsSentAt: null,
      // An opted-out lead is filtered here as well as inside sendIntroSms.
      // Belt and braces: this keeps them out of the batch count entirely, so
      // the numbers reported describe real work rather than known no-ops.
      smsOptedOutAt: null,
    },
    // Oldest first - a lead that has been waiting longest is the most urgent,
    // and the whole product promise is speed of first response.
    orderBy: { createdAt: "asc" },
    take: limit,
  });

  const outcome: RetryOutcome = {
    attempted: pending.length,
    sent: 0,
    skipped: 0,
    failed: 0,
    quotaExhausted: false,
  };

  for (const lead of pending) {
    try {
      await sendIntroSms(lead);
      outcome.sent += 1;
    } catch (error) {
      if (error instanceof SmsSuppressedError) {
        if (error.reason === "quota-exhausted") {
          // Stop the whole run. Continuing would throw identically for every
          // remaining lead and report them as failures rather than as work
          // still queued.
          outcome.quotaExhausted = true;
          logger.warn("Intro SMS retry stopped: monthly quota reached", {
            sent: outcome.sent,
            remaining: pending.length - outcome.sent - outcome.skipped,
          });
          break;
        }

        // Opted out between the query and the send. Not a failure.
        outcome.skipped += 1;
        continue;
      }

      // One bad lead must not abandon the rest of the batch. It keeps a null
      // introSmsSentAt, so the next run picks it up again.
      outcome.failed += 1;
      logger.error("Intro SMS retry failed for a lead", {
        leadId: lead.id,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  logger.info("Intro SMS retry complete", { ...outcome });

  return outcome;
}

/** How many leads are still owed a first message. */
export async function countPendingIntroSms(): Promise<number> {
  return prisma.lead.count({
    where: { introSmsSentAt: null, smsOptedOutAt: null },
  });
}
