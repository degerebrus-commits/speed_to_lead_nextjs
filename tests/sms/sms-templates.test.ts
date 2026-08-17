import { describe, expect, it } from "vitest";
import { DEFAULT_SMS_INTRO_TEMPLATE } from "@/config/env";
import { buildIntroMessage, extractFirstName, renderTemplate } from "@/server/sms/sms-templates";

describe("the default intro template", () => {
  it("renders the PRD introductory copy exactly", () => {
    // Full-string equality on purpose. This is the first thing a customer ever
    // reads from the product, so the shipped default is pinned; a client that
    // wants different wording overrides SMS_INTRO_TEMPLATE rather than editing
    // this expectation.
    expect(buildIntroMessage("John Carter", "ABC HVAC", DEFAULT_SMS_INTRO_TEMPLATE)).toBe(
      "Hi John! Thanks for contacting ABC HVAC. I'm here to help. Can you tell me a little about the issue you're experiencing?",
    );
  });

  it("carries the placeholders the renderer substitutes", () => {
    expect(DEFAULT_SMS_INTRO_TEMPLATE).toContain("{firstName}");
    expect(DEFAULT_SMS_INTRO_TEMPLATE).toContain("{businessName}");
  });
});

describe("buildIntroMessage", () => {
  it("carries any client's name and wording without a code change", () => {
    const template = "{businessName} here - hi {firstName}, what can we help with?";

    expect(buildIntroMessage("Maria Delgado", "Foster Plumbing", template)).toBe(
      "Foster Plumbing here - hi Maria, what can we help with?",
    );
  });
});

describe("renderTemplate", () => {
  it("substitutes every occurrence of a placeholder", () => {
    expect(
      renderTemplate("{firstName}, {firstName} - {businessName}", {
        firstName: "Ada",
        businessName: "Acme",
      }),
    ).toBe("Ada, Ada - Acme");
  });

  it("does not double the full stop for a business named \"... Inc.\"", () => {
    // Real client name. Without the seam fix this reads "Inc.. I'm here".
    expect(
      renderTemplate("Thanks for contacting {businessName}. I'm here to help.", {
        firstName: "Test",
        businessName: "Classic Air & Heat, Inc.",
      }),
    ).toBe("Thanks for contacting Classic Air & Heat, Inc. I'm here to help.");
  });

  it("leaves a business name without trailing punctuation alone", () => {
    expect(
      renderTemplate("Thanks for contacting {businessName}. Bye.", {
        firstName: "Test",
        businessName: "Northwind Heating",
      }),
    ).toBe("Thanks for contacting Northwind Heating. Bye.");
  });

  it("leaves an unknown placeholder visible instead of blanking it", () => {
    // A silent empty string would ship a sentence with a hole in it to a real
    // customer; leaving the token makes the misconfiguration obvious.
    expect(
      renderTemplate("Hi {firstName}, ref {ticketId}", {
        firstName: "Ada",
        businessName: "Acme",
      }),
    ).toBe("Hi Ada, ref {ticketId}");
  });
});

describe("extractFirstName", () => {
  it("takes the first token and tolerates the messiness of one free-text field", () => {
    expect(extractFirstName("John Carter")).toBe("John");
    expect(extractFirstName("  Priya   Raman  ")).toBe("Priya");
    expect(extractFirstName("Cher")).toBe("Cher");
  });
});
