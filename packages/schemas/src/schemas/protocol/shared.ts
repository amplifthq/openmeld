import { z } from "zod/v4";

export const trimmedStringFromUnknown = (value: unknown): string =>
  String(value ?? "").trim();

export const nonEmptyTrimmedStringFromUnknown = z.preprocess(
  trimmedStringFromUnknown,
  z.string().min(1)
);

export const finiteIntegerNumber = z.number().int().finite();

export const optionalBooleanQuerySchema = z.preprocess((value) => {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  if (typeof value === "boolean") {
    return value;
  }
  const normalized = String(value).trim().toLowerCase();
  if (normalized === "true" || normalized === "1") {
    return true;
  }
  if (normalized === "false" || normalized === "0") {
    return false;
  }
  return value;
}, z.boolean().optional());
