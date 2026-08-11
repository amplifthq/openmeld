import type { z } from "zod/v4";

type DaemonRuntimeLeaseModeSchema =
  typeof import("../../schemas/daemon/runtime-lease")["daemonRuntimeLeaseModeSchema"];
type DaemonRuntimeLeaseSchema =
  typeof import("../../schemas/daemon/runtime-lease")["daemonRuntimeLeaseSchema"];

export type DaemonRuntimeLease = z.infer<DaemonRuntimeLeaseSchema>;
export type DaemonRuntimeLeaseMode = z.infer<DaemonRuntimeLeaseModeSchema>;
