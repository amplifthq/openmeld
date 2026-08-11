import type { z } from "zod/v4";

type DaemonServiceContractSchema =
  typeof import("../../schemas/daemon/service-contract")["daemonServiceContractSchema"];
type DaemonServiceControllerSchema =
  typeof import("../../schemas/daemon/service-contract")["daemonServiceControllerSchema"];
type DaemonServiceDesiredStateSchema =
  typeof import("../../schemas/daemon/service-contract")["daemonServiceDesiredStateSchema"];
type DaemonServiceLaneSchema =
  typeof import("../../schemas/daemon/service-contract")["daemonServiceLaneSchema"];

export type DaemonServiceContract = z.infer<DaemonServiceContractSchema>;
export type DaemonServiceController = z.infer<DaemonServiceControllerSchema>;
export type DaemonServiceDesiredState =
  z.infer<DaemonServiceDesiredStateSchema>;
export type DaemonServiceLane = z.infer<DaemonServiceLaneSchema>;
