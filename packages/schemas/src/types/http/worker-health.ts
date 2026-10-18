import type { z } from "zod/v4";

type Schemas = typeof import("../../schemas/http/worker-health");

export type WorkerHealthResponse = z.infer<
  Schemas["workerHealthResponseSchema"]
>;
