/** Carrier failures; use .code (CARRIER_AUTH_ERROR, CARRIER_CLIENT_ERROR, CARRIER_SERVER_ERROR, CARRIER_UNEXPECTED_ERROR). */
export class CarrierError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly carrierId?: string,
  ) {
    super(message);
    this.name = "CarrierError";
  }
}

export function authError(message: string, carrierId?: string): CarrierError {
  return new CarrierError(message, "CARRIER_AUTH_ERROR", carrierId);
}

export function clientError(message: string, carrierId?: string): CarrierError {
  return new CarrierError(message, "CARRIER_CLIENT_ERROR", carrierId);
}

export function serverError(message: string, carrierId?: string): CarrierError {
  return new CarrierError(message, "CARRIER_SERVER_ERROR", carrierId);
}

export function unexpectedError(
  message: string,
  carrierId?: string,
): CarrierError {
  return new CarrierError(message, "CARRIER_UNEXPECTED_ERROR", carrierId);
}
