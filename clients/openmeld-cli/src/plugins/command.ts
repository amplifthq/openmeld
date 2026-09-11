import { createPluginsApi } from "@openmeld/api-client";
import { pluginActionRequestSchema } from "@openmeld/schemas";
import type {
  PluginActionRequest,
  PluginActionResponse,
} from "@openmeld/schemas/types";
import { getAuthSessionState } from "../config/auth-session";
import { resolveBaseUrl } from "../config/base-url";
import { resolveOpenMeldProfile } from "../config/openmeld-profiles-api";
import { buildOpenMeldRequestContextFromProfile } from "../config/openmeld-request-context";
import { resolveRuntimeContext } from "../runtime/context";
import { OPENMELD_DISPATCH_RUNTIME_MODE_ENV } from "../runtime/dispatch-runtime-env";
import {
  OPENMELD_SPACE_ACTION_CONTEXT_PATH_ENV,
  readDispatchSpaceActionContextFromEnv,
} from "../runtime/dispatch-space-action-context";
import { createPresenter } from "../runtime/presenter/index";
import { createCliApiClientFoundation } from "../space/api-client-foundation";
import { outLine } from "../ui/io";

export async function runPluginCommand(input: {
  action: PluginActionRequest["action"];
  profile?: string;
  view?: string;
}) {
  const auth = await getAuthSessionState({ validateRemote: true });
  const organization = auth.session?.activeOrganization;
  if (auth.state !== "valid" || !organization) {
    throw new Error(
      "Sign in and choose an organization with `openmeld login` and `openmeld org switch <slug>`."
    );
  }
  const dispatch =
    process.env[OPENMELD_DISPATCH_RUNTIME_MODE_ENV] ||
    process.env[OPENMELD_SPACE_ACTION_CONTEXT_PATH_ENV]
      ? readDispatchSpaceActionContextFromEnv()
      : null;
  if (dispatch && input.profile && input.profile !== dispatch.targetProfileId) {
    throw new Error("The selected profile must match this Wake’s Local Agent.");
  }
  const profileId = dispatch?.targetProfileId ?? input.profile;
  if (!profileId) {
    throw new Error(
      "Choose your Local Agent with --profile <agent-profile-id>. Inside a Wake, its Agent is selected automatically."
    );
  }
  const profile = await resolveOpenMeldProfile({
    openMeldProfileId: profileId,
    profileKind: "agent",
  });
  const request = pluginActionRequestSchema.parse({
    action: input.action,
    ...(dispatch ? { dispatchId: dispatch.dispatchId } : {}),
  });
  const api = createPluginsApi(
    createCliApiClientFoundation(await resolveBaseUrl())
  );
  const response = await api.action({
    organizationId: organization.id,
    requestContext: buildOpenMeldRequestContextFromProfile({
      openMeldProfile: profile,
    }),
    request,
  });
  const runtime = await resolveRuntimeContext({ view: input.view });
  const presenter = createPresenter(runtime);
  if (presenter.view === "agent") {
    presenter.data({ code: `plugins.${response.kind}`, payload: response });
  } else {
    renderPluginResponse(response);
  }
  if (
    response.kind === "execution" &&
    (response.status === "failed" || response.status === "outcome_unknown")
  ) {
    process.exitCode = 1;
  }
}

function renderPluginResponse(response: PluginActionResponse) {
  if (response.kind === "connections") {
    if (response.connections.length === 0) {
      outLine(
        "No accounts grant this Local Agent access. Open Plugins to configure access."
      );
    }
    for (const connection of response.connections) {
      outLine(
        `${connection.service} · ${connection.scope === "shared" ? "Shared" : "Personal"} · ${connection.ownerDisplayName} · ${connection.permission === "read" ? "Read only" : "Read and write"}`
      );
    }
    return;
  }
  outLine(
    `Account: ${response.connection.ownerDisplayName} (${response.connection.scope === "shared" ? "shared" : "personal"})`
  );
  if (response.kind === "actions") {
    for (const action of response.actions) {
      outLine(
        `${action.id} · ${action.effect ?? "unspecified"}\n${action.description}\nInput: ${JSON.stringify(action.inputSchema)}`
      );
    }
    return;
  }
  if (response.kind === "confirmation_required") {
    outLine(response.message);
    outLine(
      `Action: ${response.actionId}\nOperation: ${response.operationId}\nRepeat the same command with --confirm ${response.confirmationToken} after confirmation.`
    );
    return;
  }
  outLine(
    `${response.status}${response.replayed ? " (previously recorded; not executed again)" : ""} · ${response.operationId}`
  );
  if (response.error) {
    outLine(response.error);
  }
  if (response.data !== undefined) {
    outLine(JSON.stringify(response.data, null, 2));
  }
}
