import { toStructuredApiClientFailure } from "@openmeld/api-client";
import type { DaemonStatusServerRequirementUnavailableReason } from "@openmeld/schemas";
import type {
  LocalCliComponentUpdateProjection,
  LocalServiceComponentUpdateProjection,
} from "@openmeld/schemas/types";
import { getAuthSessionState } from "../config/auth-session";
import { readCurrentLocalRuntimeReplyReadiness } from "../system/current-local-runtime-reply-readiness";

/**
 * Why the server-required version visor could not be resolved. Kept as a
 * small closed set (never the raw error) so callers can render a stable,
 * short "unavailable (<reason>)" message without leaking transport details.
 */
export type ServerRequiredVersionUnavailableReason =
  DaemonStatusServerRequirementUnavailableReason;

/**
 * The server's view of what CLI/Service version this account currently
 * needs, read live from Core's compiled release manifest via
 * `getCurrentLocalRuntimeReplyReadiness` (`localComponents.cli` /
 * `.localComponents.service`). This is the second book the release-channel
 * check (`cli-update-assessment.ts`) has no visibility into: Core's release
 * manifest and the published release channel (npm registry / R2
 * `cli/manifest.json`) are stamped independently and can disagree — that gap
 * is exactly what caused the W-REL-DOCTOR half-rollout incident (Core
 * required 0.2.21 while the release channel was still serving 0.2.20).
 */
export type ServerRequiredVersionAssessment =
  | {
      available: true;
      generatedAt: string;
      cli: LocalCliComponentUpdateProjection;
      service: LocalServiceComponentUpdateProjection;
    }
  | {
      available: false;
      reason: ServerRequiredVersionUnavailableReason;
      detail: string | null;
    };

/**
 * Resolves the server-required version visor for the current account.
 *
 * Skips the network round-trip entirely when there is no valid local auth
 * session (a request would 401 anyway), so `openmeld service status` /
 * `openmeld doctor` degrade instantly instead of waiting on a call already
 * known to fail. Any transport failure (offline, timeout, gateway error,
 * invalid response) is caught here and turned into an `available: false`
 * result: this function must never throw, and must never block or slow down
 * the release-channel view it is displayed alongside.
 *
 * Reuses the existing authenticated CLI-to-gateway channel
 * (`readCurrentLocalRuntimeReplyReadiness`, already used elsewhere — e.g. to
 * confirm reply readiness during `openmeld setup`) instead of opening a new
 * one, so it inherits that channel's short, bounded request timeout
 * (`DEFAULT_SPACE_REQUEST_TIMEOUT_MS`) and cannot hang `status`/`doctor`.
 */
export async function assessServerRequiredVersion(input: {
  gatewayUrl: string;
}): Promise<ServerRequiredVersionAssessment> {
  const authState = await getAuthSessionState({ validateRemote: false }).catch(
    () => null
  );
  if (authState?.state !== "valid" || !authState.session) {
    return { available: false, reason: "signed_out", detail: null };
  }

  try {
    const response = await readCurrentLocalRuntimeReplyReadiness({
      gatewayUrl: input.gatewayUrl,
    });
    return {
      available: true,
      generatedAt: response.generatedAt,
      cli: response.localComponents.cli,
      service: response.localComponents.service,
    };
  } catch (error) {
    return {
      available: false,
      ...classifyServerRequiredVersionFailure(error),
    };
  }
}

/**
 * Renders a short, stable phrase for an unavailable server-required version
 * result, safe to inline in "unavailable (<reason>)" copy.
 */
export function describeServerRequiredVersionUnavailableReason(
  assessment: Extract<ServerRequiredVersionAssessment, { available: false }>
): string {
  if (assessment.reason === "signed_out") {
    return "not signed in";
  }
  return assessment.detail ?? "request failed";
}

function classifyServerRequiredVersionFailure(error: unknown): {
  reason: ServerRequiredVersionUnavailableReason;
  detail: string | null;
} {
  const failure = toStructuredApiClientFailure(error);
  if (failure.status === 401 || failure.status === 403) {
    return { reason: "signed_out", detail: failure.message };
  }
  if (
    failure.code === "network.timeout" ||
    failure.code === "network.request_failed"
  ) {
    return { reason: "offline", detail: failure.message };
  }
  return { reason: "request_failed", detail: failure.message };
}
