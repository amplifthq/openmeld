import {
  createMemberAgentsApi,
  isMemberAgentsDisabledError,
  OpenMeldApiClientHttpError,
} from "@openmeld/api-client";
import {
  type HarnessKind,
  HOSTED_HARNESS_KIND,
  type ListMemberAgentsResponse,
  MEMBER_AGENTS_DISABLED_CODE,
  MEMBER_AGENTS_DISABLED_MESSAGE,
  MEMBER_AGENTS_ENABLED,
  type MemberAgentSource,
  type MemberAgentWithProfiles,
} from "@openmeld/schemas";
import { createAuthenticationError } from "../auth/auth-guidance";
import { getAuthSessionState } from "../config/auth-session";
import type { OpenMeldProfile } from "../config/openmeld-profiles-api";
import { createCliApiClientFoundation } from "../space/api-client-foundation";
import { resolveHumanControllerDisplayName } from "../ui/controller-display";

const MEMBER_AGENTS_DISABLED_NEXT_STEP =
  "Keep using `openmeld profiles list` to see your Agent Profiles.";
const ORGANIZATION_NEXT_STEP =
  "Run `openmeld org switch <slug>` to choose an organization, then try again.";

/** A MemberAgent command failure with one product next step. */
export class MemberAgentCommandError extends Error {
  readonly code: string;
  readonly nextStep: string;
  readonly title: string;

  constructor(input: {
    code: string;
    message: string;
    nextStep: string;
    title: string;
  }) {
    super(input.message);
    this.name = "MemberAgentCommandError";
    this.code = input.code;
    this.nextStep = input.nextStep;
    this.title = input.title;
  }
}

export class MemberAgentsDisabledError extends MemberAgentCommandError {
  constructor() {
    super({
      code: MEMBER_AGENTS_DISABLED_CODE,
      message: MEMBER_AGENTS_DISABLED_MESSAGE,
      nextStep: MEMBER_AGENTS_DISABLED_NEXT_STEP,
      title: "Agents Not Enabled",
    });
  }
}

/** The shared release decision; every MemberAgent CLI surface checks it. */
export function isMemberAgentsEnabled(): boolean {
  return MEMBER_AGENTS_ENABLED;
}

/**
 * MemberAgents are Organization-scoped. Without an active Organization there
 * is no parent to print, so Profile commands skip the read instead of failing.
 */
export async function hasActiveOrganizationForMemberAgents(): Promise<boolean> {
  const auth = await getAuthSessionState({ validateRemote: false });
  return Boolean(auth.session?.activeOrganization?.id);
}

/**
 * Read the signed-in member's MemberAgents in the active Organization from
 * Auth. Never calls the route while the release flag is off. An explicit
 * `organization` (slug or id) must name the active Organization.
 */
export async function readMemberAgentListing(
  input: { organization?: string } = {}
): Promise<ListMemberAgentsResponse> {
  if (!isMemberAgentsEnabled()) {
    throw new MemberAgentsDisabledError();
  }
  const auth = await getAuthSessionState({ validateRemote: false });
  if (auth.state !== "valid" || !auth.session) {
    throw createAuthenticationError({ reason: "required" });
  }
  const activeOrganization = auth.session.activeOrganization;
  if (!activeOrganization?.id) {
    throw new MemberAgentCommandError({
      code: "member_agents.organization_required",
      message: "Choose an organization to see its Agents.",
      nextStep: ORGANIZATION_NEXT_STEP,
      title: "Organization Required",
    });
  }
  const selector = input.organization?.trim();
  if (
    selector &&
    selector !== activeOrganization.id &&
    selector.toLowerCase() !== activeOrganization.slug.toLowerCase()
  ) {
    throw new MemberAgentCommandError({
      code: "member_agents.organization_mismatch",
      message: `Agents are read from your current organization, ${activeOrganization.name}, not "${selector}".`,
      nextStep: ORGANIZATION_NEXT_STEP,
      title: "Different Organization",
    });
  }
  const api = createMemberAgentsApi(
    createCliApiClientFoundation(auth.session.authBaseUrl, {
      organizationId: activeOrganization.id,
    })
  );
  try {
    return await api.list();
  } catch (error) {
    throw toMemberAgentReadError(error);
  }
}

function toMemberAgentReadError(error: unknown): unknown {
  if (isMemberAgentsDisabledError(error)) {
    return new MemberAgentsDisabledError();
  }
  if (!(error instanceof OpenMeldApiClientHttpError)) {
    return error;
  }
  // Auth replies with `{ ok: false, code, message }`, not a Gateway envelope.
  const body = parseAuthErrorBody(error.rawBody);
  const code = body?.code ?? "member_agents.read_failed";
  return new MemberAgentCommandError({
    code,
    message:
      body?.message ??
      `OpenMeld couldn't read your Agents (HTTP ${error.status}).`,
    nextStep: code.startsWith("organization.")
      ? ORGANIZATION_NEXT_STEP
      : "Try again. If it keeps failing, run `openmeld doctor`.",
    title: "Agents Unavailable",
  });
}

function parseAuthErrorBody(
  rawBody: string
): { code: string | null; message: string | null } | null {
  try {
    const body: unknown = JSON.parse(rawBody);
    if (typeof body !== "object" || body === null) {
      return null;
    }
    const { code, message } = body as { code?: unknown; message?: unknown };
    return {
      code: typeof code === "string" && code ? code : null,
      message: typeof message === "string" && message ? message : null,
    };
  } catch {
    return null;
  }
}

export type MemberAgentView = {
  id: string;
  /** Derived for display only, never stored: "Owner's Harness". */
  displayName: string;
  harnessKind: HarnessKind;
  harnessDisplayName: string;
  ownerUserId: string;
  /** The owner's default Human Profile name, or null when it is not visible. */
  ownerName: string | null;
  source: MemberAgentSource;
  archived: boolean;
  archivedAt: string | null;
  profileCount: number;
  defaultProfile: { openMeldProfileId: string; profileName: string } | null;
  profiles: MemberAgentWithProfiles["profiles"];
};

export type MemberAgentListingView = {
  organizationId: string;
  memberAgents: MemberAgentView[];
  unassignedProfiles: ListMemberAgentsResponse["unassignedProfiles"];
};

export function formatHarnessDisplayName(harnessKind: HarnessKind): string {
  if (harnessKind === HOSTED_HARNESS_KIND) {
    return "Remote Agent";
  }
  return resolveHumanControllerDisplayName({
    agentControllerRef: `builtin:${harnessKind}`,
  });
}

export function buildMemberAgentListingView(input: {
  listing: ListMemberAgentsResponse;
  profiles: readonly OpenMeldProfile[];
}): MemberAgentListingView {
  return {
    organizationId: input.listing.organizationId,
    memberAgents: input.listing.memberAgents.map((memberAgent) =>
      buildMemberAgentView({ memberAgent, profiles: input.profiles })
    ),
    unassignedProfiles: input.listing.unassignedProfiles,
  };
}

function buildMemberAgentView(input: {
  memberAgent: MemberAgentWithProfiles;
  profiles: readonly OpenMeldProfile[];
}): MemberAgentView {
  const { memberAgent } = input;
  const harnessDisplayName = formatHarnessDisplayName(memberAgent.harnessKind);
  const ownerName = resolveOwnerName({
    ownerUserId: memberAgent.ownerUserId,
    profiles: input.profiles,
  });
  const defaultProfile =
    memberAgent.profiles.find(
      (profile) => profile.openMeldProfileId === memberAgent.defaultProfileId
    ) ?? null;
  return {
    id: memberAgent.id,
    displayName: ownerName
      ? `${ownerName}'s ${harnessDisplayName}`
      : harnessDisplayName,
    harnessKind: memberAgent.harnessKind,
    harnessDisplayName,
    ownerUserId: memberAgent.ownerUserId,
    ownerName,
    source: memberAgent.source,
    archived: memberAgent.archivedAt !== null,
    archivedAt: memberAgent.archivedAt,
    profileCount: memberAgent.profiles.length,
    defaultProfile: defaultProfile
      ? {
          openMeldProfileId: defaultProfile.openMeldProfileId,
          profileName: defaultProfile.profileName,
        }
      : null,
    profiles: memberAgent.profiles,
  };
}

function resolveOwnerName(input: {
  ownerUserId: string;
  profiles: readonly OpenMeldProfile[];
}): string | null {
  const defaultHumanProfile = input.profiles.find(
    (profile) =>
      profile.profileKind === "human" &&
      profile.isDefault === true &&
      profile.ownerUserId === input.ownerUserId
  );
  const name = defaultHumanProfile?.profileName.trim();
  return name ? name : null;
}

/**
 * Resolve `agent show <id|name>`: an exact MemberAgent id, then the harness
 * kind (unique per owner and Organization), then the derived display name.
 */
export function findMemberAgentView(input: {
  view: MemberAgentListingView;
  selector: string;
}): MemberAgentView | null {
  const selector = input.selector.trim();
  const lowered = selector.toLowerCase();
  return (
    input.view.memberAgents.find((agent) => agent.id === selector) ??
    input.view.memberAgents.find((agent) => agent.harnessKind === lowered) ??
    input.view.memberAgents.find(
      (agent) =>
        agent.displayName.toLowerCase() === lowered ||
        agent.harnessDisplayName.toLowerCase() === lowered
    ) ??
    null
  );
}

export type ProfileMemberAgentParent =
  | {
      status: "assigned";
      memberAgentId: string;
      displayName: string;
      harnessKind: HarnessKind;
    }
  | { status: "unassigned" };

/**
 * The parent MemberAgent of one Agent Profile, or null when the listing does
 * not cover the Profile (another owner's Profile or a non-agent Profile).
 */
export function resolveProfileMemberAgentParent(input: {
  view: MemberAgentListingView;
  openMeldProfileId: string;
}): ProfileMemberAgentParent | null {
  for (const memberAgent of input.view.memberAgents) {
    if (
      memberAgent.profiles.some(
        (profile) => profile.openMeldProfileId === input.openMeldProfileId
      )
    ) {
      return {
        status: "assigned",
        memberAgentId: memberAgent.id,
        displayName: memberAgent.displayName,
        harnessKind: memberAgent.harnessKind,
      };
    }
  }
  if (
    input.view.unassignedProfiles.some(
      (profile) => profile.openMeldProfileId === input.openMeldProfileId
    )
  ) {
    return { status: "unassigned" };
  }
  return null;
}

export function formatProfileMemberAgentParent(
  parent: ProfileMemberAgentParent
): string {
  return parent.status === "assigned"
    ? `${parent.displayName} (id: ${parent.memberAgentId})`
    : "unassigned";
}
