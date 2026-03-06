# Cybership Carrier Integration Service

Node.js library that talks to shipping carrier APIs through one simple interface. Right now it supports **UPS** (Rating API v2403) with OAuth and in-memory token caching.

---

## Why it’s built this way

- **One carrier interface** — `Carrier` has `carrierId` and `getRates(request)`. You register a carrier and call `getRates(carrierId, request)`; we validate and route. Adding FedEx or DHL later doesn’t change callers.
- **Shared request/quote shapes** — `RateRequest` (origin, destination, packages) and `RateQuote` (serviceCode, amount, currency, etc.) are carrier-agnostic; each carrier maps to its own API.
- **Zod** — Requests are validated before any carrier is called. Bad input → clear error + `CarrierError` with `CARRIER_CLIENT_ERROR`. Types come from the schemas.
- **Structured errors** — All failures use `CarrierError` with a `code` (auth / client / server / unexpected). We map HTTP sensibly and retry once on 401 after clearing the token cache.
- **UPS** — OAuth token cached until 5 min before expiry; `fetch` is injectable so tests mock it and never hit the real API.

---

## How to run it

You need **Node.js 20+** and npm (or something compatible).

Install deps:

```bash
npm install
```

For UPS you’ll need these env vars:

| Variable              | What it’s for                    |
|-----------------------|-----------------------------------|
| `UPS_CLIENT_ID`       | UPS OAuth client ID              |
| `UPS_CLIENT_SECRET`   | UPS OAuth client secret          |
| `UPS_BASE_URL`        | e.g. `https://wwwcie.ups.com` (sandbox) |
| `UPS_ACCOUNT_NUMBER`  | Your UPS account number          |

Handy commands:

```bash
npm test              
npx tsc --noEmit      
npm run build         
```

Using the library after a build:

```ts
import { getRates, createUPSCarrier, register } from "carrier-integration-service";
import type { RateRequest, RateQuote } from "carrier-integration-service";

register(createUPSCarrier()); // or pass your own fetch

const request: RateRequest = {
  origin: { city: "A", stateOrProvinceCode: "CA", postalCode: "90210", countryCode: "US" },
  destination: { city: "B", stateOrProvinceCode: "NY", postalCode: "10001", countryCode: "US" },
  packages: [{ weight: 5, weightUnit: "LBS" }],
};

const quotes: RateQuote[] = await getRates("ups", request);
```

---

## What I’d do with more time

- **Linting** — ESLint + TypeScript rules and a `lint` script so style and obvious issues are caught early.
- **Logging** — Structured logs (request id, carrier, duration, error code) and simple metrics for prod.
- **Retries** — Retry with backoff (and maybe a circuit breaker) for 5xx and flaky responses so one bad carrier doesn’t hang everything.
- **Config** — Validate env at startup in one place so missing or invalid config fails fast.
