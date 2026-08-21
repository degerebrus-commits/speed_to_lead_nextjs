import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { resetEnvCache } from "@/config/env";
import { checkCoverage, isWithinServiceArea } from "@/server/booking/service-area";

/**
 * Coverage is decided in code, not by the model.
 *
 * It used to reach the assistant only as prose in the system prompt, so whether
 * an address qualified was a judgement a customer could argue with. A model
 * asked nicely enough makes an exception the business never agreed to, and the
 * first anyone hears of it is a technician driving somewhere they do not go.
 */

const ORIGINAL = process.env.SERVICE_AREA_CITIES;

function covering(list: string) {
  process.env.SERVICE_AREA_CITIES = list;
  resetEnvCache();
}

beforeEach(() => covering("Quezon City,Makati,Pasig"));

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.SERVICE_AREA_CITIES;
  else process.env.SERVICE_AREA_CITIES = ORIGINAL;
  resetEnvCache();
});

describe("checkCoverage", () => {
  it("accepts an address in a covered place", () => {
    expect(checkCoverage("47 Narra St, Quezon City")).toBe("inside");
    expect(checkCoverage("12 Ayala Ave, Makati")).toBe("inside");
  });

  it("refuses an address outside the list", () => {
    expect(checkCoverage("47 Narra St, Mandaluyong")).toBe("outside");
  });

  it("ignores case, punctuation and repeated spaces", () => {
    // A customer typing an address on a phone produces all of these.
    expect(checkCoverage("47 narra st.,  QUEZON   CITY")).toBe("inside");
  });

  it("requires a multi-word place to appear as a phrase", () => {
    // "Quezon" alone is a province as well as part of the city name; matching
    // on the first word would cover somewhere three hours away.
    expect(checkCoverage("Barangay Tayabas, Quezon Province")).toBe("outside");
  });

  it("does not match a place name inside another word", () => {
    // A street named after a city is not the city.
    expect(checkCoverage("8 Pasig Boulevard Extension, Cainta")).toBe("inside");
    expect(checkCoverage("8 Makatipunan Road, Antipolo")).toBe("outside");
  });

  it("returns null when no list is configured", () => {
    // Not decided, rather than inside or outside. The caller must send this to
    // a person - a deployment that forgot to configure coverage should not
    // silently accept every address in the country.
    covering("");

    expect(checkCoverage("anywhere at all")).toBeNull();
    expect(isWithinServiceArea("anywhere at all")).toBe(false);
  });

  it("treats an empty address as outside", () => {
    expect(checkCoverage("   ")).toBe("outside");
  });

  it("tolerates a messy list", () => {
    covering("  Makati , ,Pasig,  ");

    expect(checkCoverage("1 Buendia, Makati")).toBe("inside");
    expect(checkCoverage("1 Main St, Taguig")).toBe("outside");
  });
});

describe("US addresses", () => {
  // The product is sold to US businesses; the Philippine list is only what
  // this deployment happens to be testing with. Nothing in the matcher knows
  // which country it is looking at.
  beforeEach(() => covering("Kansas City,Salt Lake City,Austin,St. Louis"));

  it("matches a multi-word city in a full US address", () => {
    expect(checkCoverage("1200 Main St, Kansas City, MO 64105")).toBe("inside");
    expect(checkCoverage("55 W South Temple, Salt Lake City, UT 84101")).toBe("inside");
  });

  it("matches a single-word city", () => {
    expect(checkCoverage("901 S Congress Ave, Austin, TX 78704")).toBe("inside");
  });

  it("ignores punctuation in the configured name", () => {
    // "St. Louis" in config, "St Louis" as typed, or the other way round.
    expect(checkCoverage("100 N Broadway, St Louis, MO 63102")).toBe("inside");
  });

  it("refuses a city that is not on the list", () => {
    expect(checkCoverage("400 Main St, Dallas, TX 75201")).toBe("outside");
  });

  it("does not match a city name that is only part of the street", () => {
    // "Austin Street" in Houston is not Austin.
    expect(checkCoverage("14 Austintown Road, Youngstown, OH")).toBe("outside");
  });
});
