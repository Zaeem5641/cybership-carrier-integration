import type { Address, Package, RateRequest, RateQuote } from "../domain.js";
import { getToken, clearTokenCache } from "./auth.js";
import { CarrierError, authError, clientError, serverError, unexpectedError } from "../errors.js";
import type { Carrier } from "../carriers.js";

function getUPSEnv(): { baseUrl: string; accountNumber: string } {
  const baseUrl = process.env.UPS_BASE_URL?.replace(/\/$/, "");
  const accountNumber = process.env.UPS_ACCOUNT_NUMBER;
  if (!baseUrl || !accountNumber) {
    throw new Error("Missing UPS_BASE_URL or UPS_ACCOUNT_NUMBER");
  }
  return { baseUrl, accountNumber };
}

function mapAddressToUPS(addr: Address, name: string): { Name: string; Address: Record<string, unknown> } {
  const lines = addr.addressLines?.length ? addr.addressLines : [addr.city];
  return {
    Name: name,
    Address: {
      AddressLine: lines,
      City: addr.city,
      StateProvinceCode: addr.stateOrProvinceCode,
      PostalCode: addr.postalCode,
      CountryCode: addr.countryCode,
      ...(addr.residential ? { ResidentialAddressIndicator: "Y" } : {}),
    },
  };
}

function mapPackageToUPS(pkg: Package): Record<string, unknown> {
  const dims = pkg.dimensions ?? { length: 1, width: 1, height: 1 };
  const dimUnit = pkg.dimensionUnit ?? "IN";
  return {
    PackagingType: { Code: "02", Description: "Package" },
    Dimensions: {
      UnitOfMeasurement: { Code: dimUnit, Description: dimUnit === "IN" ? "Inches" : "Centimeters" },
      Length: String(Math.round(dims.length)),
      Width: String(Math.round(dims.width)),
      Height: String(Math.round(dims.height)),
    },
    PackageWeight: {
      UnitOfMeasurement: { Code: pkg.weightUnit, Description: pkg.weightUnit === "LBS" ? "Pounds" : "Kilograms" },
      Weight: String(pkg.weight),
    },
  };
}

function buildUPSRequest(request: RateRequest, accountNumber: string): unknown {
  const requestOption = request.serviceCode ? "Rate" : "Shop";
  const packageList = request.packages.length === 1
    ? mapPackageToUPS(request.packages[0])
    : request.packages.map(mapPackageToUPS);
  return {
    RateRequest: {
      Request: { RequestOption: requestOption },
      Shipment: {
        Shipper: mapAddressToUPS(request.origin, "Shipper"),
        ShipTo: mapAddressToUPS(request.destination, "Ship To"),
        ShipFrom: mapAddressToUPS(request.origin, "Ship From"),
        PaymentDetails: {
          ShipmentCharge: [{ Type: "01", BillShipper: { AccountNumber: accountNumber } }],
        },
        NumOfPieces: String(request.packages.length),
        Package: packageList,
        ...(request.serviceCode ? { Service: { Code: request.serviceCode, Description: "" } } : {}),
      },
    },
  };
}

function parseOneRatedShipment(item: Record<string, unknown>, carrierId: string): RateQuote {
  const service = item.Service as { Code?: string; Description?: string } | undefined;
  const totalCharges = (item.NegotiatedRateCharges as { TotalCharge?: { MonetaryValue?: string; CurrencyCode?: string } })?.TotalCharge
    ?? (item.TotalCharges as { MonetaryValue?: string; CurrencyCode?: string });
  const amount = parseFloat(totalCharges?.MonetaryValue ?? "0");
  const currency = totalCharges?.CurrencyCode ?? "USD";
  return {
    carrierId,
    serviceCode: service?.Code ?? "",
    serviceName: service?.Description ?? "",
    amount,
    currency,
  };
}

function parseUPSResponse(json: unknown, carrierId: string): RateQuote[] {
  const root = json as { RateResponse?: { RatedShipment?: unknown } };
  const ratedShipment = root?.RateResponse?.RatedShipment;
  if (!ratedShipment) {
    throw unexpectedError("UPS rate response missing RatedShipment", carrierId);
  }
  const list = Array.isArray(ratedShipment) ? ratedShipment : [ratedShipment];
  return list.map((item) => parseOneRatedShipment(item as Record<string, unknown>, carrierId));
}

async function callRateAPI(
  baseUrl: string,
  token: string,
  body: unknown,
  fetchFn: typeof fetch
): Promise<Response> {
  const requestOption = (body as { RateRequest?: { Request?: { RequestOption?: string } } }).RateRequest?.Request?.RequestOption ?? "Shop";
  const url = `${baseUrl}/api/rating/v2403/${requestOption}`;
  return fetchFn(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
}

function throwForStatus(res: Response, bodyText: string, carrierId: string): never {
  const status = res.status;
  if (status === 401) throw authError("UPS rate request unauthorized", carrierId);
  if (status === 429) throw clientError("UPS rate limit exceeded", carrierId);
  if (status >= 400 && status < 500) throw clientError(`UPS rate request failed: ${status} ${bodyText}`, carrierId);
  if (status >= 500) throw serverError(`UPS rate request failed: ${status} ${bodyText}`, carrierId);
  throw unexpectedError(`UPS rate request failed: ${status} ${bodyText}`, carrierId);
}

async function fetchRates(request: RateRequest, fetchFn: typeof fetch, isRetry = false): Promise<RateQuote[]> {
  const env = getUPSEnv();
  const token = await getToken(fetchFn);
  const body = buildUPSRequest(request, env.accountNumber);
  const res = await callRateAPI(env.baseUrl, token, body, fetchFn);

  if (!res.ok) {
    const text = await res.text();
    if (res.status === 401 && !isRetry) {
      clearTokenCache();
      return fetchRates(request, fetchFn, true);
    }
    throwForStatus(res, text, "ups");
  }

  let json: unknown;
  try {
    json = await res.json();
  } catch {
    throw unexpectedError("UPS rate response was not valid JSON", "ups");
  }
  return parseUPSResponse(json, "ups");
}

/** UPS implementation of Carrier; register with register(new UPSCarrier()) or register(createUPSCarrier()). */
export class UPSCarrier implements Carrier {
  readonly carrierId = "ups";

  constructor(private readonly fetchFn: typeof fetch = fetch) {}

  async getRates(request: RateRequest): Promise<RateQuote[]> {
    return fetchRates(request, this.fetchFn);
  }
}

/** Returns a UPS carrier instance (e.g. register(createUPSCarrier(mockFetch)) in tests). */
export function createUPSCarrier(fetchFn: typeof fetch = fetch): Carrier {
  return new UPSCarrier(fetchFn);
}
