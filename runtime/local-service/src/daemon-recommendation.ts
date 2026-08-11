import type {
  DaemonBootstrapAutoInstallMode,
  DaemonBootstrapRecommendationResult,
} from "@openmeld/schemas";
import { daemonBootstrapRecommendationResultSchema } from "@openmeld/schemas";

export function buildDaemonBootstrapRecommendationResult(input: {
  mode: DaemonBootstrapAutoInstallMode;
  note: string;
}): DaemonBootstrapRecommendationResult {
  const parsed = daemonBootstrapRecommendationResultSchema.safeParse({
    type: "result",
    code: "daemon.bootstrap.recommended",
    payload: {
      recommended: true,
      reason: "service_missing",
      autoInstallMode: input.mode,
      installCommand: "openmeld service install",
      configureAlwaysFlag: "--service-auto-install always",
      configureSkipFlag: "--service-auto-install never",
      note: input.note,
    },
  });
  if (!parsed.success) {
    throw new Error("daemon bootstrap recommendation envelope is invalid");
  }
  return parsed.data;
}
