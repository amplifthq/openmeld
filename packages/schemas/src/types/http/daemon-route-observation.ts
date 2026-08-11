import type { z } from "zod/v4";

type DaemonRouteObservationResponseSchema =
  typeof import("../../schemas/http/daemon-route-observation")["daemonRouteObservationResponseSchema"];

export type DaemonRouteObservationResponse =
  z.infer<DaemonRouteObservationResponseSchema>;
