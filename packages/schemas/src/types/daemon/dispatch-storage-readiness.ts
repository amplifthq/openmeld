import type { z } from "zod/v4";

type DispatchStorageReadinessSchema =
  typeof import("../../schemas/daemon/dispatch-storage-readiness")["dispatchStorageReadinessSchema"];

export type DispatchStorageReadiness = z.infer<DispatchStorageReadinessSchema>;
