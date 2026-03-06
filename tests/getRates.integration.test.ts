import { describe, it, beforeEach } from "node:test";
import assert from "node:assert";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { getRates, register } from "../src/carriers.js";
import { createUPSCarrier } from "../src/ups/rate.js";
import { clearTokenCache } from "../src/ups/auth.js";
import { CarrierError } from "../src/errors.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturePath = join(__dirname, "fixtures", "ups-rate-response.json");
const rateResponseFixture = JSON.parse(readFileSync(fixturePath, "utf-8"));

const validRequest = {
  origin: {
    city: "Timonium",
    stateOrProvinceCode: "MD",
    postalCode: "21093",
    countryCode: "US",
  },
  destination: {
    city: "Alpharetta",
    stateOrProvinceCode: "GA",
    postalCode: "30005",
    countryCode: "US",
  },
  packages: [{ weight: 1, weightUnit: "LBS" as const }],
};

function setEnv(): void {
  process.env.UPS_CLIENT_ID = "test-client";
  process.env.UPS_CLIENT_SECRET = "test-secret";
  process.env.UPS_BASE_URL = "https://wwwcie.ups.com";
  process.env.UPS_ACCOUNT_NUMBER = "123456";
}

describe("getRates integration", () => {
  let lastRatingBody: unknown = null;
  let lastRatingUrl: string | null = null;
  let oauthCallCount = 0;

  beforeEach(() => {
    setEnv();
    clearTokenCache();
    lastRatingBody = null;
    lastRatingUrl = null;
    oauthCallCount = 0;
  });

  function createMockFetch(responses: {
    oauth?: { status: number; body?: unknown };
    rating?: { status: number; body?: unknown };
  } = {}) {
    const defaultOAuth = { status: 200, body: { access_token: "test-token", expires_in: 3600 } };
    const defaultRating = { status: 200, body: rateResponseFixture };
    const oauthRes = responses.oauth ?? defaultOAuth;
    const ratingRes = responses.rating ?? defaultRating;

    return (url: string | URL, init?: RequestInit) => {
      const u = typeof url === "string" ? url : url.toString();
      if (u.includes("/security/v1/oauth/token")) {
        oauthCallCount++;
        return Promise.resolve(
          new Response(JSON.stringify(oauthRes.body ?? {}), {
            status: oauthRes.status,
            headers: { "Content-Type": "application/json" },
          })
        );
      }
      if (u.includes("/api/rating/")) {
        lastRatingUrl = u;
        if (init?.body) lastRatingBody = JSON.parse(init.body as string);
        return Promise.resolve(
          new Response(
            ratingRes.body !== undefined ? JSON.stringify(ratingRes.body) : "invalid",
            {
              status: ratingRes.status,
              headers: { "Content-Type": "application/json" },
            }
          )
        );
      }
      return Promise.resolve(new Response("Not found", { status: 404 }));
    };
  }

  it("1. Happy path: returns normalized RateQuote[] with serviceCode, amount, currency", async () => {
    const mockFetch = createMockFetch();
    register(createUPSCarrier(mockFetch));

    const quotes = await getRates("ups", validRequest);

    assert.strictEqual(quotes.length, 2);
    assert.deepStrictEqual(quotes[0], {
      carrierId: "ups",
      serviceCode: "03",
      serviceName: "Ground",
      amount: 12.45,
      currency: "USD",
    });
    assert.deepStrictEqual(quotes[1], {
      carrierId: "ups",
      serviceCode: "11",
      serviceName: "Standard",
      amount: 24.99,
      currency: "USD",
    });
  });

  it("2. Request shape: POST body has ShipTo, packages, RequestOption", async () => {
    const mockFetch = createMockFetch();
    register(createUPSCarrier(mockFetch));

    await getRates("ups", validRequest);

    assert.ok(lastRatingBody);
    const body = lastRatingBody as { RateRequest?: { Request?: { RequestOption?: string }; Shipment?: unknown } };
    assert.strictEqual(body.RateRequest?.Request?.RequestOption, "Shop");
    const shipment = body.RateRequest?.Shipment as { ShipTo?: { Address?: { City: string } }; Package?: unknown };
    assert.strictEqual(shipment?.ShipTo?.Address?.City, "Alpharetta");
    assert.ok(shipment?.Package);
    assert.ok(lastRatingUrl?.includes("/api/rating/v2403/Shop"));
  });

  it("3. Token reuse: OAuth called once for two rate calls", async () => {
    const mockFetch = createMockFetch();
    register(createUPSCarrier(mockFetch));

    await getRates("ups", validRequest);
    await getRates("ups", validRequest);

    assert.strictEqual(oauthCallCount, 1);
  });

  it("4. Token refresh: on 401, fetches new token and retries", async () => {
    let ratingCallCount = 0;
    const mockFetch = (url: string | URL, _init?: RequestInit) => {
      const u = typeof url === "string" ? url : url.toString();
      if (u.includes("/security/v1/oauth/token")) {
        oauthCallCount++;
        return Promise.resolve(
          new Response(JSON.stringify({ access_token: "new-token", expires_in: 3600 }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          })
        );
      }
      if (u.includes("/api/rating/")) {
        ratingCallCount++;
        if (ratingCallCount === 1) {
          return Promise.resolve(
            new Response(JSON.stringify({ error: "unauthorized" }), {
              status: 401,
              headers: { "Content-Type": "application/json" },
            })
          );
        }
        return Promise.resolve(
          new Response(JSON.stringify(rateResponseFixture), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          })
        );
      }
      return Promise.resolve(new Response("Not found", { status: 404 }));
    };
    register(createUPSCarrier(mockFetch));

    const quotes = await getRates("ups", validRequest);

    assert.strictEqual(oauthCallCount, 2);
    assert.strictEqual(quotes.length, 2);
  });

  it("5a. Error: 401 on rating produces CarrierError with CARRIER_AUTH_ERROR", async () => {
    const mockFetch = createMockFetch({
      rating: { status: 401, body: { message: "Unauthorized" } },
    });
    register(createUPSCarrier(mockFetch));

    await assert.rejects(
      () => getRates("ups", validRequest),
      (err: unknown) => (err as CarrierError).code === "CARRIER_AUTH_ERROR" && (err as CarrierError).carrierId === "ups"
    );
  });

  it("5b. Error: 429 produces CarrierError with CARRIER_CLIENT_ERROR", async () => {
    const mockFetch = createMockFetch({
      rating: { status: 429, body: {} },
    });
    register(createUPSCarrier(mockFetch));

    await assert.rejects(
      () => getRates("ups", validRequest),
      (err: unknown) => (err as CarrierError).code === "CARRIER_CLIENT_ERROR"
    );
  });

  it("5c. Error: 500 produces CarrierError with CARRIER_SERVER_ERROR", async () => {
    const mockFetch = createMockFetch({
      rating: { status: 500, body: { message: "Internal Error" } },
    });
    register(createUPSCarrier(mockFetch));

    await assert.rejects(
      () => getRates("ups", validRequest),
      (err: unknown) => (err as CarrierError).code === "CARRIER_SERVER_ERROR"
    );
  });

  it("5d. Error: invalid JSON produces CarrierError with CARRIER_UNEXPECTED_ERROR", async () => {
    const mockFetch = (url: string | URL, _init?: RequestInit) => {
      const u = typeof url === "string" ? url : url.toString();
      if (u.includes("/security/v1/oauth/token")) {
        return Promise.resolve(
          new Response(JSON.stringify({ access_token: "t", expires_in: 3600 }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          })
        );
      }
      if (u.includes("/api/rating/")) {
        return Promise.resolve(
          new Response("not json at all", {
            status: 200,
            headers: { "Content-Type": "text/plain" },
          })
        );
      }
      return Promise.resolve(new Response("", { status: 404 }));
    };
    register(createUPSCarrier(mockFetch));

    await assert.rejects(
      () => getRates("ups", validRequest),
      (err: unknown) => (err as CarrierError).code === "CARRIER_UNEXPECTED_ERROR"
    );
  });
});
