import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetEnvCache } from "@/config/env";
import { TextBeeError, textBeeSmsProvider } from "@/server/sms/textbee-sms-provider";

/**
 * Every test here mocks fetch. The TextBee free tier allows 50 texts a month,
 * so the suite must never reach the real gateway - a test that spends quota
 * would be unrunnable by the third week.
 */
const API_KEY = "test-textbee-api-key";
const DEVICE_ID = "test-device-id";

let fetchMock: ReturnType<typeof vi.fn>;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  process.env.SMS_PROVIDER = "textbee";
  process.env.TEXTBEE_API_KEY = API_KEY;
  process.env.TEXTBEE_DEVICE_ID = DEVICE_ID;

  resetEnvCache();
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  process.env.SMS_PROVIDER = "console";
  resetEnvCache();
});

describe("textBeeSmsProvider.send", () => {
  it("calls the device-scoped endpoint with the documented request shape", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ data: { messageId: "abc123" } }));

    await textBeeSmsProvider.send({ to: "+15551234567", body: "Hello there" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];

    expect(url).toBe(
      `https://api.textbee.dev/api/v1/gateway/devices/${DEVICE_ID}/send-sms`,
    );
    expect(init.method).toBe("POST");
    expect(init.headers["x-api-key"]).toBe(API_KEY);
    expect(init.headers["Content-Type"]).toBe("application/json");

    // recipients is an array even for a single number - sending a bare string
    // is the mistake their API would silently reject.
    expect(JSON.parse(init.body)).toEqual({
      recipients: ["+15551234567"],
      message: "Hello there",
    });
  });

  it("sets a timeout so a sleeping handset cannot hang lead intake", async () => {
    fetchMock.mockResolvedValue(jsonResponse({}));

    await textBeeSmsProvider.send({ to: "+15551234567", body: "Hi" });

    expect(fetchMock.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
  });

  it("returns the provider message id when one is supplied", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ data: { messageId: "msg-777" } }));

    const result = await textBeeSmsProvider.send({ to: "+15551234567", body: "Hi" });

    expect(result.providerMessageId).toBe("msg-777");
    expect(result.provider).toBe("textbee");
  });

  it("still succeeds when the response body is not the shape we expected", async () => {
    // Their response schema is undocumented. A 2xx means the gateway accepted
    // the message; failing the send over a missing id would be wrong.
    fetchMock.mockResolvedValue(new Response("", { status: 200 }));

    const result = await textBeeSmsProvider.send({ to: "+15551234567", body: "Hi" });

    expect(result.providerMessageId).toMatch(/^textbee-unknown-/);
  });

  it("throws on a non-2xx response", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: "device offline" }, 502));

    await expect(
      textBeeSmsProvider.send({ to: "+15551234567", body: "Hi" }),
    ).rejects.toBeInstanceOf(TextBeeError);
  });

  it("throws on a transport failure", async () => {
    fetchMock.mockRejectedValue(new Error("network unreachable"));

    await expect(
      textBeeSmsProvider.send({ to: "+15551234567", body: "Hi" }),
    ).rejects.toBeInstanceOf(TextBeeError);
  });

  it("never puts the API key in an error message", async () => {
    fetchMock.mockRejectedValue(new Error(`connect failed using ${API_KEY}`));

    // The key travels in the request headers; it must not travel into logs via
    // a thrown message that gets serialised by the route's error handler.
    const error = await textBeeSmsProvider
      .send({ to: "+15551234567", body: "Hi" })
      .catch((caught: Error) => caught);

    expect((error as Error).message).not.toContain(API_KEY);
  });

  it("refuses to send when credentials are absent", async () => {
    delete process.env.TEXTBEE_API_KEY;
    delete process.env.TEXTBEE_DEVICE_ID;
    process.env.SMS_PROVIDER = "console";
    resetEnvCache();

    await expect(
      textBeeSmsProvider.send({ to: "+15551234567", body: "Hi" }),
    ).rejects.toThrow();

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
