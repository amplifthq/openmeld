import { OpenMeldApiClientHttpError } from "@openmeld/api-client";
import {
  type DetectedHarnessKind,
  detectedHarnessKindSchema,
  harnessKindFromAgentControllerRef,
  MEMBER_AGENT_SYNC_ROUTE,
  type SyncMemberAgentsResponse,
  syncMemberAgentsResponseSchema,
} from "@openmeld/schemas";
import { createAuthenticationError } from "../auth/auth-guidance";
import { getAuthSessionState } from "../config/auth-session";
import { resolveBaseUrl } from "../config/base-url";
import { createCliApiClientFoundation } from "../space/api-client-foundation";
import {
  isMemberAgentsEnabled,
  MemberAgentCommandError,
  MemberAgentsDisabledError,
} from "./read";

/**
 * The detected Harnesses behind local agent ids such as `claude-code`.
 * Unknown ids and controllers without a Harness drop out.
 */
export function harnessKindsFromLocalAgentIds(
  localAgentIds: readonly string[]
): DetectedHarnessKind[] {
  const harnessKinds = new Set<DetectedHarnessKind>();
  for (const id of localAgentIds) {
    const parsed = detectedHarnessKindSchema.safeParse(
      harnessKindFromAgentControllerRef(`builtin:${id.trim()}`)
    );
    if (parsed.success) {
      harnessKinds.add(parsed.data);
    }
  }
  return [...harnessKinds].sort();
}

/**
 * Ask Core to reconcile the member's Agents in the active Organization.
 * Only the Harnesses in `createHarnessKinds` get a new Agent; an empty list
 * finishes existing Agents and reports the addable Harnesses.
 */
export async function syncMemberAgents(input: {
  createHarnessKinds: readonly DetectedHarnessKind[];
}): Promise<SyncMemberAgentsResponse> {
  if (!isMemberAgentsEnabled()) {
    throw new MemberAgentsDisabledError();
  }
  const auth = await getAuthSessionState({ validateRemote: false });
  if (auth.state !== "valid" || !auth.session) {
    throw createAuthenticationError({ reason: "required" });
  }
  const organizationId = auth.session.activeOrganization?.id;
  if (!organizationId) {
    throw new MemberAgentCommandError({
      code: "member_agents.organization_required",
      message: "Choose an organization to add Agents to.",
      nextStep:
        "Run `openmeld org switch <slug>` to choose an organization, then try again.",
      title: "Organization Required",
    });
  }
  const client = createCliApiClientFoundation(await resolveBaseUrl(), {
    organizationId,
  });
  try {
    return await client.requestJson({
      body: JSON.stringify({ createHarnessKinds: input.createHarnessKinds }),
      headers: { "content-type": "application/json" },
      invalidMessage: "Invalid Agent sync response.",
      method: "POST",
      operation: "member_agents.sync",
      schema: syncMemberAgentsResponseSchema,
      url: MEMBER_AGENT_SYNC_ROUTE,
    });
  } catch (error) {
    if (!(error instanceof OpenMeldApiClientHttpError)) {
      throw error;
    }
    if (error.status === 404) {
      throw new MemberAgentsDisabledError();
    }
    throw new MemberAgentCommandError({
      code: "member_agents.sync_failed",
      message: `OpenMeld couldn't update your Agents (HTTP ${error.status}).`,
      nextStep: "Try again. If it keeps failing, run `openmeld doctor`.",
      title: "Agents Unavailable",
    });
  }
}

export type SetupMemberAgentsResult =
  | { status: "skipped"; reason: string }
  | {
      status: "synced";
      createdHarnessKinds: DetectedHarnessKind[];
      addableHarnessKinds: DetectedHarnessKind[];
    }
  | { status: "failed"; message: string };

/**
 * Setup adds an Agent only for each local agent the member selected
 * (`--local-agent`, or the agents chosen on the Connect page). Other detected
 * Harnesses stay addable with `openmeld agent add`. Setup never fails here:
 * a skipped or failed step is reported and the next sync finishes it.
 */
export async function addSetupSelectedMemberAgents(input: {
  selectedLocalAgentIds: readonly string[];
}): Promise<SetupMemberAgentsResult> {
  const createHarnessKinds = harnessKindsFromLocalAgentIds(
    input.selectedLocalAgentIds
  );
  if (!isMemberAgentsEnabled()) {
    return { status: "skipped", reason: "member_agents.disabled" };
  }
  if (createHarnessKinds.length === 0) {
    return { status: "skipped", reason: "member_agents.none_selected" };
  }
  try {
    const response = await syncMemberAgents({ createHarnessKinds });
    return {
      status: "synced",
      createdHarnessKinds: response.results
        .filter((result) => result.outcome === "created")
        .map((result) => result.harnessKind),
      addableHarnessKinds: response.addableHarnessKinds,
    };
  } catch (error) {
    if (error instanceof MemberAgentCommandError) {
      return error instanceof MemberAgentsDisabledError ||
        error.code === "member_agents.organization_required"
        ? { status: "skipped", reason: error.code }
        : { status: "failed", message: error.message };
    }
    const message = error instanceof Error ? error.message : String(error);
    console.warn("[openmeld.setup.member_agents.failed]", {
      error: message,
      event: "cli.setup.member_agents.failed",
    });
    return { status: "failed", message };
  }
}
