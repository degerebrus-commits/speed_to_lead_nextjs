import { beforeEach, describe, expect, it } from "vitest";
import { resetEnvCache } from "@/config/env";
import { detectEmergency } from "@/server/sms/emergency-detection";

/**
 * This is the safety path. It runs before the model and decides whether the
 * model gets to answer at all, so it has to work with the AI provider down.
 */
describe("detectEmergency", () => {
  beforeEach(() => {
    process.env.EMERGENCY_KEYWORDS =
      "no heat,no ac,gas smell,flooding,water leak,carbon monoxide,smoke,system sparking,no hot water";
    resetEnvCache();
  });

  it("matches a configured keyword inside an ordinary sentence", () => {
    const result = detectEmergency("Hi, we have no heat and the baby is here");

    expect(result.isEmergency).toBe(true);
    expect(result.matchedKeyword).toBe("no heat");
  });

  it("ignores case and punctuation", () => {
    expect(detectEmergency("GAS SMELL!!!").isEmergency).toBe(true);
    expect(detectEmergency("There is a Gas Smell.").isEmergency).toBe(true);
  });

  it("tolerates doubled spacing", () => {
    expect(detectEmergency("we have  no    heat").isEmergency).toBe(true);
  });

  it("honours the explicit EMERGENCY reply the after-hours message invites", () => {
    // The after-hours copy tells customers to reply EMERGENCY. That promise
    // has to be kept regardless of which keywords happen to be configured.
    process.env.EMERGENCY_KEYWORDS = "";
    resetEnvCache();

    expect(detectEmergency("EMERGENCY").isEmergency).toBe(true);
    expect(detectEmergency("emergency").isEmergency).toBe(true);
  });

  it("does not fire on ordinary messages", () => {
    const ordinary = [
      "My aircon is broken",
      "Can someone come look at the unit next week",
      "How much is a service call",
      "The thermostat screen is blank",
    ];

    for (const message of ordinary) {
      expect(detectEmergency(message).isEmergency, message).toBe(false);
    }
  });

  it("returns false for an empty message rather than matching everything", () => {
    expect(detectEmergency("").isEmergency).toBe(false);
    expect(detectEmergency("   ").isEmergency).toBe(false);
  });

  it("fires on every configured keyword", () => {
    // Where a config list and behaviour must agree and nothing enforces it,
    // assert they agree - a keyword silently failing to match is exactly the
    // bug that stays hidden until it matters.
    const keywords = (process.env.EMERGENCY_KEYWORDS as string).split(",");

    for (const keyword of keywords) {
      const result = detectEmergency(`Hello, ${keyword} right now`);
      expect(result.isEmergency, keyword).toBe(true);
    }
  });

  it("respects a client configuring different keywords", () => {
    process.env.EMERGENCY_KEYWORDS = "burst pipe,sewage backup";
    resetEnvCache();

    expect(detectEmergency("There is a burst pipe").isEmergency).toBe(true);
    expect(detectEmergency("no heat").isEmergency).toBe(false);
  });
});
