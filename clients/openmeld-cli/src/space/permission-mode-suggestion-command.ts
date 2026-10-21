import { createPermissionModeSuggestionsApi } from "@openmeld/api-client";
import { getAuthSessionState } from "../config/auth-session";
import { resolveBaseUrl } from "../config/base-url";
import { resolveOpenMeldProfile } from "../config/openmeld-profiles-api";
import { buildOpenMeldRequestContextFromProfile } from "../config/openmeld-request-context";
import { readDispatchSpaceActionContextFromEnv } from "../runtime/dispatch-space-action-context";
import { outLine } from "../ui/io";
import { createCliApiClientFoundation } from "./api-client-foundation";

/**
 * The `suggest_permission_mode` task action. It asks Core to show the Agent
 * owner a one-click card for the permission mode named in this Wake's
 * advisory. It never changes a setting; Core accepts it only for the
 * owner-requested Wake that received the advisory.
 */
export async function runSpaceActionSuggestPermissionMode(): Promise<void> {
  const context = readDispatchSpaceActionContextFromEnv();
  if (!context.executionTokenEcho) {
    throw new Error(
      "This command works only inside a current OpenMeld task that received a permission-mode suggestion."
    );
  }
  const auth = await getAuthSessionState({ validateRemote: true });
  const organization = auth.session?.activeOrganization;
  if (auth.state !== "valid" || !organization) {
    throw new Error("OpenMeld sign-in is unavailable on this Computer.");
  }
  const profile = await resolveOpenMeldProfile({
    openMeldProfileId: context.targetProfileId,
    profileKind: "agent",
  });
  const api = createPermissionModeSuggestionsApi(
    createCliApiClientFoundation(await resolveBaseUrl())
  );
  const response = await api.suggest({
    organizationId: organization.id,
    request: {
      dispatchId: context.dispatchId,
      executionTokenEcho: context.executionTokenEcho,
    },
    requestContext: buildOpenMeldRequestContextFromProfile({
      openMeldProfile: profile,
    }),
  });
  outLine(
    response.status === "already_resolved"
      ? "Your owner already handled this suggestion. Do not mention it again."
      : "Your owner now sees a card to apply the suggested permission mode. Do not change settings yourself."
  );
}
