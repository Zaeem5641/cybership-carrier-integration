import { register } from "./carriers.js";
import { createUPSCarrier } from "./ups/rate.js";

register(createUPSCarrier());

export { getRates, register } from "./carriers.js";
export type { Carrier } from "./carriers.js";
export { createUPSCarrier, UPSCarrier } from "./ups/rate.js";
export type { Address, Package, RateRequest, RateQuote } from "./domain.js";
export {
  CarrierError,
  authError,
  clientError,
  serverError,
  unexpectedError,
} from "./errors.js";
