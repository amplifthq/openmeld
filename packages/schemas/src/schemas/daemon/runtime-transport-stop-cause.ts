import { z } from "zod/v4";

export const runtimeTransportStopCauseSchema = z.enum([
  "user_stop",
  "controlled_service_update",
  "service_crash",
  "network_disconnect",
  "unknown",
]);
