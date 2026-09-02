import { createAgentProfileBindingApi } from "@openmeld/api-client";
import { resolveBaseUrl } from "../config/base-url";
import { resolveRuntimeContext } from "../runtime/context";
import { createPresenter } from "../runtime/presenter";
import { createCliApiClientFoundation } from "../space/api-client-foundation";
import { detectLocalAgentEnvironment } from "../space/local-agent-environment";

const SUPPORTED_PROVIDERS = new Set(["claude-code", "codex"]);

export async function runProfileCurrentSession(input: {
  nativeSessionId?: string;
  provider?: string;
  view?: string;
}): Promise<void> {
  const runtime = await resolveRuntimeContext({ view: input.view });
  const presenter = createPresenter(runtime);
  const session = resolveCurrentSessionInput(input);
  const result = await createAgentProfileBindingApi(
    createCliApiClientFoundation(await resolveBaseUrl())
  ).getCurrentSession({
    agentControllerConversationId: session.agentControllerConversationId,
    agentControllerRef: session.agentControllerRef,
  });

  if (runtime.resolvedView === "agent") {
    presenter.data({ code: "profile.current_session", payload: result });
    return;
  }
  if (result.status === "not_found") {
    presenter.line({
      code: "profile.current_session.not_found",
      text: `No Agent Profile is bound to this ${session.conversationLabel} in the current account.`,
    });
    return;
  }
  if (result.status === "unavailable") {
    presenter.line({
      code: "profile.current_session.unavailable",
      text: `OpenMeld found a Binding for this ${session.conversationLabel}, but its Agent Profile identity is unavailable (${result.reasonCode}).`,
    });
    return;
  }
  presenter.line({
    code: "profile.current_session.found",
    text: result.sameOrganization
      ? `${result.profile.profileName} (${result.profile.profileId}) is bound to this ${session.conversationLabel} in the current Organization.`
      : `${result.profile.profileName} (${result.profile.profileId}) is bound to this ${session.conversationLabel}, but it belongs to Organization ${result.profile.profileOrganizationId}, not the current Organization ${result.currentOrganizationId}.`,
  });
}

function resolveCurrentSessionInput(input: {
  nativeSessionId?: string;
  provider?: string;
}): {
  agentControllerConversationId: string;
  agentControllerRef: string;
  conversationLabel: "session" | "thread";
} {
  const explicitProvider = normalizeOptionalString(
    input.provider
  )?.toLowerCase();
  const explicitSessionId = normalizeOptionalString(input.nativeSessionId);
  if (explicitProvider || explicitSessionId) {
    if (!(explicitProvider && explicitSessionId)) {
      throw new Error(
        "Pass both --provider and --native-session, or omit both to inspect the current Codex or Claude Code session."
      );
    }
    if (!SUPPORTED_PROVIDERS.has(explicitProvider)) {
      throw new Error("--provider must be codex or claude-code.");
    }
    return {
      agentControllerConversationId: explicitSessionId,
      agentControllerRef: `builtin:${explicitProvider}`,
      conversationLabel: explicitProvider === "codex" ? "thread" : "session",
    };
  }

  const detected = detectLocalAgentEnvironment(process.env);
  if (detected.kind === "agent") {
    return {
      agentControllerConversationId: detected.agentControllerConversationId,
      agentControllerRef: detected.agentControllerRef,
      conversationLabel: detected.conversationKind,
    };
  }
  if (detected.kind === "codex_missing_thread") {
    throw new Error(
      "This looks like Codex, but CODEX_THREAD_ID is unavailable. Pass --provider codex --native-session <thread-id>."
    );
  }
  throw new Error(
    "OpenMeld could not detect a current Codex or Claude Code session. Pass --provider and --native-session explicitly."
  );
}

function normalizeOptionalString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}
