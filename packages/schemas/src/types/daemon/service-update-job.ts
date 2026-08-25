import type { z } from "zod/v4";

type DaemonServiceUpdateJobSchema =
  typeof import("../../schemas/daemon/service-update-job")["daemonServiceUpdateJobSchema"];

export type DaemonServiceUpdateJob = z.infer<DaemonServiceUpdateJobSchema>;
