import type { z } from "zod/v4";

type DaemonRouteObservationStatusSchema =
  typeof import("../../schemas/daemon/route-observation-summary")["daemonRouteObservationStatusSchema"];
type DaemonRouteObservationReasonCodeSchema =
  typeof import("../../schemas/daemon/route-observation-summary")["daemonRouteObservationReasonCodeSchema"];
type DaemonRouteObservationSummarySchema =
  typeof import("../../schemas/daemon/route-observation-summary")["daemonRouteObservationSummarySchema"];

export type DaemonRouteObservationStatus =
  z.infer<DaemonRouteObservationStatusSchema>;
export type DaemonRouteObservationReasonCode =
  z.infer<DaemonRouteObservationReasonCodeSchema>;
export type DaemonRouteObservationSummary =
  z.infer<DaemonRouteObservationSummarySchema>;
