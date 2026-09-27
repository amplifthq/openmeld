import {
  appendPluginConnectionReplyLink,
  buildOpenMeldNavigationAction,
  buildOpenMeldOrganizationWebUrl,
} from "@openmeld/schemas";
import type {
  PluginActionRequest,
  PluginActionResponse,
} from "@openmeld/schemas/types";
import type { CoreBindings } from "../lib/bindings";
import { readOrganizationRouteSlug } from "../organizations/organization-context";
import { createCoreRpcHttpError } from "../rpc/errors";
import type { requireLocalPluginCaller } from "./plugin-local-caller";

/** A setup link is presentation, never a connection grant or a provider callback.
 * Native replies reuse the same compatible text/card and human-click receiver. */
export async function localPluginConnectionGuidance(
  env: CoreBindings,
  caller: Awaited<ReturnType<typeof requireLocalPluginCaller>>,
  action: Extract<PluginActionRequest["action"], { operation: "connect" }>
): Promise<PluginActionResponse> {
  const organizationSlug = await readOrganizationRouteSlug({
    env,
    organizationId: caller.organizationId,
  });
  if (!(organizationSlug && env.WEB_APP_URL)) {
    throw createCoreRpcHttpError({
      status: 503,
      code: "plugin.connection_url_unavailable",
      reason:
        "The secure Plugin connection page is unavailable. Do not construct an authorization URL.",
    });
  }
  if (action.account === "personal" && !caller.personalAllowed) {
    throw createCoreRpcHttpError({
      status: 403,
      code: "plugin.personal_request_required",
      reason:
        "This Local Agent cannot use another member's personal account. Request an authorized organization connection instead.",
    });
  }
  let scope: "member" | "shared" | "choose" = "choose";
  if (action.account === "personal") {
    scope = "member";
  } else if (action.account === "shared" || !caller.personalAllowed) {
    scope = "shared";
  }
  const navigation = buildOpenMeldNavigationAction({
    organizationWebUrl: buildOpenMeldOrganizationWebUrl({
      organizationSlug,
      webAppUrl: env.WEB_APP_URL,
    }),
    target: { kind: "plugin_connection", service: action.service, scope },
  });
  return {
    kind: "connection_guidance",
    service: action.service,
    scope,
    url: navigation.url,
    replyText: appendPluginConnectionReplyLink({
      action: navigation,
      text: `Connect or review ${action.service} access for the remaining work.`,
    }),
    canContinueInConversation: caller.sourceSpaceId !== null,
    message: caller.sourceSpaceId
      ? "Include replyText unchanged in the final reply to this Wake. The original requester can connect in that conversation and explicitly continue it. Do not run or restart work on an OAuth callback; preserve completed operation IDs."
      : "Open the secure connection page yourself, then return to the task. This standalone CLI command has no OpenMeld conversation to resume and does not start work.",
  };
}
