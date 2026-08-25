import * as z from "zod/v4";

export const IDENTITY_IMAGE_MAX_SIZE_BYTES = 5_242_880;
export const IDENTITY_IMAGE_MAX_DIMENSION = 20_000;
export const IDENTITY_IMAGE_MAX_PIXELS = 40_000_000;
export const IDENTITY_IMAGE_OUTPUT_SIZE = 512;
export const IDENTITY_IMAGE_OUTPUT_MIME_TYPE = "image/webp" as const;

export const identityImageMimeTypeSchema = z.enum([
  "image/jpeg",
  "image/png",
  "image/webp",
]);
