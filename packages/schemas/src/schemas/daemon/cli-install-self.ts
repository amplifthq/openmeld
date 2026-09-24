import * as z from "zod/v4";

// The managed installer owns activation. Desktop reads this receipt instead of
// rediscovering a possibly older npm command from its inherited PATH.
export const cliInstallSelfResultSchema = z.strictObject({
  schemaVersion: z.literal(1),
  type: z.literal("cli.install_self"),
  result: z.enum(["installed", "noop_same_version", "noop_newer_present"]),
  version: z.string().min(1),
  platform: z.string().min(1),
  managedBinaryPath: z.string().min(1),
  currentPointerPath: z.string().min(1),
  previousVersion: z.string().nullable(),
  forced: z.boolean(),
});
