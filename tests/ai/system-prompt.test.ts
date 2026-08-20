import { describe, expect, it } from "vitest";
import type { BusinessProfile } from "@/config/business";
import { buildSystemPrompt } from "@/server/ai/system-prompt";

const hvac: BusinessProfile = {
  name: "Comfort Pro Heating and Air",
  logo: "",
  repName: "Dustin",
  countryCode: "+1",
  timezone: "America/Chicago",
  hours: "Mon-Fri 8am to 6pm",
  serviceArea: "Chicago Metro",
  ownerPhone: "+15551234567",
  vertical: "HVAC",
  technicianNoun: "technician",
  serviceTypes: ["not cooling", "not heating"],
  safetyHazards: ["gas", "carbon monoxide"],
};

const plumbing: BusinessProfile = {
  ...hvac,
  name: "Riverside Plumbing",
  repName: "Alex",
  vertical: "plumbing",
  technicianNoun: "plumber",
  serviceTypes: ["burst pipe", "blocked drain"],
  safetyHazards: ["flooding", "sewage"],
};

describe("buildSystemPrompt", () => {
  it("describes the configured trade, not a hardcoded one", () => {
    const prompt = buildSystemPrompt(plumbing);

    expect(prompt).toContain("a plumbing company");
    expect(prompt).toContain("plumber");
    expect(prompt).toContain("burst pipe");
    expect(prompt).toContain("blocked drain");

    // The whole point of the template: nothing HVAC-specific leaks through
    // when the business is a plumber.
    expect(prompt.toLowerCase()).not.toContain("hvac");
    expect(prompt.toLowerCase()).not.toContain("technician");
    expect(prompt.toLowerCase()).not.toContain("not cooling");
  });

  it("still reads correctly for the HVAC client", () => {
    const prompt = buildSystemPrompt(hvac);

    expect(prompt).toContain("an HVAC company".replace("an ", "a "));
    expect(prompt).toContain("Comfort Pro Heating and Air");
    expect(prompt).toContain("not cooling");
    expect(prompt).toContain("carbon monoxide");
  });

  it("says the service area is unconfigured rather than inventing one", () => {
    const prompt = buildSystemPrompt({ ...hvac, serviceArea: "" });

    expect(prompt).toContain("NOT CONFIGURED");
    expect(prompt).toContain("have the team confirm");
  });

  it("falls back to generic wording when categories and hazards are unset", () => {
    const prompt = buildSystemPrompt({ ...hvac, serviceTypes: [], safetyHazards: [] });

    expect(prompt).toContain("in the customer's own words");
    expect(prompt).toContain("sounds dangerous");
  });

  it("always forbids pricing, diagnosis and repair instructions", () => {
    // These guardrails are not per-client and must survive any configuration.
    for (const profile of [hvac, plumbing]) {
      const prompt = buildSystemPrompt(profile);
      expect(prompt).toContain("Do not quote prices");
      expect(prompt).toContain("Do not diagnose");
      expect(prompt).toContain("Do not give repair instructions");
    }
  });
});
