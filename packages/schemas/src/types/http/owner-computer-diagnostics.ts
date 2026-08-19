import type { z } from "zod/v4";

type Schemas = typeof import("../../schemas/http/owner-computer-diagnostics");

export type ComputerFileAccessSummary = z.infer<
  Schemas["computerFileAccessSummarySchema"]
>;
export type OwnerComputerDiagnostics = z.infer<
  Schemas["ownerComputerDiagnosticsSchema"]
>;
