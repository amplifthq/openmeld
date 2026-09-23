import * as z from "zod/v4";

/** Exact Authenticode publisher identity shared by CLI and Desktop artifacts. */
export const windowsPublisherNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(512)
  .regex(/^[^\p{Cc}]+$/u);
