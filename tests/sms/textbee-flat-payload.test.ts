import { describe, expect, it } from "vitest";

import { normalizeTextBeePayload } from "@/server/sms/inbound-message-service";

/**
 * The shape TextBee actually sends, captured from a real delivery on
 * 2026-08-19 after two days of blaming the handset for not capturing inbound.
 *
 * It was arriving with a valid signature and being rejected as "Unrecognised
 * SMS webhook event", because the event field is `webhookEvent` rather than
 * `event` and the message fields sit at the top level rather than under `data`.
 */
const REAL_PAYLOAD = {
  smsId: "68a3f1c2b4e5d6a7f8091234",
  message: "Book me in",
  deviceId: "68a1d2e3f4a5b6c7d8e90123",
  webhookSubscriptionId: "68a2e3f4a5b6c7d8e9012345",
  webhookEvent: "message.received",
  idempotencyKey: "idem-0123456789abcdef",
  sender: "+639534305571",
  receivedAt: "2026-08-19T04:20:03.000Z",
};

describe("TextBee's real payload shape", () => {
  it("is recognised as an inbound message", () => {
    const normalized = normalizeTextBeePayload(REAL_PAYLOAD);

    expect(normalized).not.toBeNull();
    expect(normalized!.data.sender).toBe("+639534305571");
    expect(normalized!.data.message).toBe("Book me in");
  });

  it("uses smsId as the idempotency key, so a redelivery collides", () => {
    // The unique constraint on providerMessageId is what stops a retried
    // webhook being processed as a second customer message.
    expect(normalizeTextBeePayload(REAL_PAYLOAD)!.data._id).toBe(REAL_PAYLOAD.smsId);
  });

  it("falls back to idempotencyKey when smsId is absent", () => {
    const { smsId: _omitted, ...withoutSmsId } = REAL_PAYLOAD;

    expect(normalizeTextBeePayload(withoutSmsId)!.data._id).toBe("idem-0123456789abcdef");
  });

  it("ignores delivery receipts rather than treating them as customer messages", () => {
    for (const event of ["message.sent", "message.delivered", "message.failed"]) {
      expect(normalizeTextBeePayload({ ...REAL_PAYLOAD, webhookEvent: event }), event).toBeNull();
    }
  });

  it("accepts an unfamiliar event name that still carries a sender and a body", () => {
    // Being strict about the event name is exactly what caused the original
    // failure - the field was undocumented and did not match.
    const normalized = normalizeTextBeePayload({ ...REAL_PAYLOAD, webhookEvent: "sms:inbound:new" });

    expect(normalized).not.toBeNull();
  });

  it("returns null for the documented nested shape, which the other path handles", () => {
    expect(
      normalizeTextBeePayload({
        event: "MESSAGE_RECEIVED",
        timestamp: "2026-08-19T04:20:03.000Z",
        data: { _id: "abc", sender: "+639534305571", message: "hello" },
      }),
    ).toBeNull();
  });

  it("returns null when there is no identifier to deduplicate on", () => {
    const { smsId: _a, idempotencyKey: _b, ...noId } = REAL_PAYLOAD;

    expect(normalizeTextBeePayload(noId)).toBeNull();
  });
});
