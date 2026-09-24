import * as z from "zod/v4";

export const WINDOWS_INTERNAL_PREVIEW_MANIFEST_URL =
  "https://openmeld.ai/cli/manifest.json?channel=windows-preview";

export const WINDOWS_PROCESS_HELPER_FILENAME = "openmeld-windows-process.exe";

// Cross-process record consumed by the native managed CLI launcher. It selects
// an immutable installation, never a caller-supplied executable path.
export const windowsManagedCliInstallationSchema = z.strictObject({
  schemaVersion: z.literal(1),
  version: z
    .string()
    .max(128)
    .regex(/^[0-9][0-9A-Za-z.+-]*$/u),
});

/** Exact Authenticode publisher identity shared by CLI and Desktop artifacts. */
export const windowsPublisherNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(512)
  .regex(/^[^\p{Cc}]+$/u);
