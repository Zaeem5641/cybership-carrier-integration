import { z } from "zod";

export const addressSchema = z.object({
  city: z.string().min(1),
  stateOrProvinceCode: z.string().min(1),
  postalCode: z.string().min(1),
  countryCode: z.string().length(2),
  addressLines: z.array(z.string()).optional(),
  residential: z.boolean().optional(),
});

export type Address = z.infer<typeof addressSchema>;

export const dimensionsSchema = z.object({
  length: z.number().positive(),
  width: z.number().positive(),
  height: z.number().positive(),
});

export const packageSchema = z.object({
  weight: z.number().positive(),
  weightUnit: z.enum(["LBS", "KGS"]),
  dimensions: dimensionsSchema.optional(),
  dimensionUnit: z.enum(["IN", "CM"]).optional(),
});

export type Package = z.infer<typeof packageSchema>;

export const rateRequestSchema = z.object({
  origin: addressSchema,
  destination: addressSchema,
  packages: z.array(packageSchema).min(1),
  serviceCode: z.string().optional(),
});

export type RateRequest = z.infer<typeof rateRequestSchema>;

export interface RateQuote {
  carrierId: string;
  serviceCode: string;
  serviceName: string;
  amount: number;
  currency: string;
}
