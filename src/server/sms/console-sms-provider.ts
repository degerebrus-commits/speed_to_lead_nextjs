import { randomUUID } from "node:crypto";
import type { SmsMessage, SmsProvider, SmsResult } from "./sms-provider";

/**
 * Phase 1 stub. Prints the message that a real provider would deliver.
 *
 * The body is printed on its own line, verbatim, so what a customer would
 * receive can be read and diffed directly rather than dug out of a JSON blob.
 */
export const consoleSmsProvider: SmsProvider = {
  name: "console",

  async send(message: SmsMessage): Promise<SmsResult> {
    console.log(`[sms:console] -> ${message.to}`);
    console.log(message.body);

    return {
      providerMessageId: `console-${randomUUID()}`,
      provider: "console",
    };
  },
};
