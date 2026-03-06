import type { RateRequest, RateQuote } from "./domain.js";
import { rateRequestSchema } from "./domain.js";
import { clientError } from "./errors.js";

/** Contract for rate-capable carriers; implement per carrier (e.g. UPSCarrier, FedExCarrier). */
export interface Carrier {
  readonly carrierId: string;
  getRates(request: RateRequest): Promise<RateQuote[]>;
}

const registry = new Map<string, Carrier>();

/** Registers a carrier so getRates(carrierId, ...) can use it. */
export function register(carrier: Carrier): void {
  registry.set(carrier.carrierId, carrier);
}

/** Validates request, looks up carrier by id, returns carrier.getRates(parsed). */
export function getRates(carrierId: string, request: unknown): Promise<RateQuote[]> {
  const parsed = rateRequestSchema.safeParse(request);
  if (!parsed.success) {
    const msg = parsed.error.errors.map((e) => `${e.path.join(".")}: ${e.message}`).join("; ");
    throw clientError(`Invalid rate request: ${msg}`, carrierId);
  }
  const carrier = registry.get(carrierId);
  if (!carrier) {
    throw clientError(`Unknown carrier: ${carrierId}`, carrierId);
  }
  return carrier.getRates(parsed.data);
}
