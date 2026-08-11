import type { z } from "zod/v4";

type DaemonBootstrapAutoInstallModeSchema =
  typeof import("../../schemas/daemon/service-recommendation")["daemonBootstrapAutoInstallModeSchema"];
type DaemonBootstrapRecommendationPayloadSchema =
  typeof import("../../schemas/daemon/service-recommendation")["daemonBootstrapRecommendationPayloadSchema"];
type DaemonBootstrapRecommendationResultSchema =
  typeof import("../../schemas/daemon/service-recommendation")["daemonBootstrapRecommendationResultSchema"];

export type DaemonBootstrapAutoInstallMode =
  z.infer<DaemonBootstrapAutoInstallModeSchema>;
export type DaemonBootstrapRecommendationPayload =
  z.infer<DaemonBootstrapRecommendationPayloadSchema>;
export type DaemonBootstrapRecommendationResult =
  z.infer<DaemonBootstrapRecommendationResultSchema>;
