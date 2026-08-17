export interface SmsMessage {
  /** E.164 destination number. */
  to: string;
  body: string;
}

export interface SmsResult {
  /** Provider-assigned id, retained so delivery can be reconciled later. */
  providerMessageId: string;
  /** Which implementation actually handled the send. */
  provider: string;
}

/**
 * Business logic depends on this interface rather than on a vendor SDK, so
 * swapping the console stub for Twilio in Phase 3 touches one file and no
 * callers (STANDARDS.md 32).
 */
export interface SmsProvider {
  readonly name: string;
  send(message: SmsMessage): Promise<SmsResult>;
}
