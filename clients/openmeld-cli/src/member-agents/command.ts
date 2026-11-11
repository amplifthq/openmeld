import {
  HOSTED_HARNESS_KIND,
  HOSTED_REMOTE_AGENT_CONTROLLER_REF,
  harnessKindFromAgentControllerRef,
  MEMBER_AGENT_SYNC_HARNESS_NOT_DETECTED_REASON,
} from "@openmeld/schemas";
import {
  listOpenMeldProfiles,
  type OpenMeldProfile,
} from "../config/openmeld-profiles-api";
import { resolveRuntimeContext } from "../runtime/context";
import { createPresenter } from "../runtime/presenter/index";
import type { Presenter } from "../runtime/presenter/types";
import { resolveAgentProfilePrimaryAgentControllerReport } from "../system/agent-profile-primary-binding";
import { renderHumanErrorCard } from "../ui/human-error-card";
import { renderInfoCard } from "../ui/info-card";
import {
  buildMemberAgentListingView,
  findMemberAgentView,
  formatHarnessDisplayName,
  isMemberAgentsEnabled,
  MemberAgentCommandError,
  type MemberAgentListingView,
  MemberAgentsDisabledError,
  type MemberAgentView,
  readMemberAgentListing,
} from "./read";
import { harnessKindsFromLocalAgentIds, syncMemberAgents } from "./sync";

export class MemberAgentNotFoundError extends MemberAgentCommandError {
  constructor(selector: string) {
    super({
      code: "member_agents.not_found",
      message: `No Agent matches "${selector}" in this organization.`,
      nextStep:
        "Run `openmeld agent list` and copy an Agent ID or harness name.",
      title: "Agent Not Found",
    });
  }
}

export type MemberAgentProfileComputer =
  | { status: "bound"; openMeldServiceRuntimeId: string }
  | { status: "not_bound" }
  | { status: "unreadable"; message: string };

export async function runAgentList(input: { view?: string }): Promise<void> {
  const runtime = await resolveRuntimeContext({ view: input.view });
  const presenter = createPresenter(runtime);
  try {
    const view = await loadMemberAgentListingView();
    if (presenter.view === "agent") {
      presenter.data({
        code: "member_agents.list",
        payload: buildMemberAgentListPayload(view),
      });
      return;
    }
    renderMemberAgentList({ presenter, view });
  } catch (error) {
    emitMemberAgentCommandError({ error, presenter });
  }
}

export async function runAgentShow(input: {
  memberAgent: string;
  view?: string;
}): Promise<void> {
  const runtime = await resolveRuntimeContext({ view: input.view });
  const presenter = createPresenter(runtime);
  try {
    const { profiles, view } = await loadMemberAgentListingContext();
    const memberAgent = findMemberAgentView({
      selector: input.memberAgent,
      view,
    });
    if (!memberAgent) {
      throw new MemberAgentNotFoundError(input.memberAgent);
    }
    const computers = await readProfileComputers({ memberAgent, profiles });
    if (presenter.view === "agent") {
      presenter.data({
        code: "member_agents.show",
        payload: {
          organizationId: view.organizationId,
          memberAgent: toMemberAgentPayload(memberAgent),
          profiles: memberAgent.profiles.map((profile) => ({
            openMeldProfileId: profile.openMeldProfileId,
            profileName: profile.profileName,
            isDefault: profile.isDefault,
            computer: computers.get(profile.openMeldProfileId) ?? null,
          })),
          unassignedProfileCount: view.unassignedProfiles.length,
        },
      });
      return;
    }
    renderMemberAgentDetail({
      computers,
      memberAgent,
      presenter,
      unassignedProfileCount: view.unassignedProfiles.length,
    });
  } catch (error) {
    emitMemberAgentCommandError({ error, presenter });
  }
}

/**
 * `openmeld agent add <harness>`: add the Agent of a Harness one of the
 * member's connected computers has installed. The Local agents switch is
 * the member's choice (design-plans/member-agent-program.md §4.1), so Core
 * turns the Harness on there if it is off, then creates the Agent: the same
 * Core sync the Add action in OpenMeld Web uses.
 */
export async function runAgentAdd(input: {
  harness: string;
  view?: string;
}): Promise<void> {
  const runtime = await resolveRuntimeContext({ view: input.view });
  const presenter = createPresenter(runtime);
  try {
    const [harnessKind] = harnessKindsFromLocalAgentIds([input.harness]);
    if (!harnessKind) {
      throw new MemberAgentCommandError({
        code: "member_agents.harness_unknown",
        message: `"${input.harness}" is not a harness OpenMeld can add as an Agent.`,
        nextStep:
          "Run `openmeld agent list` to see the harnesses found on your computers.",
        title: "Unknown Harness",
      });
    }
    const response = await syncMemberAgents({
      createHarnessKinds: [harnessKind],
    });
    const result = response.results.find(
      (candidate) => candidate.harnessKind === harnessKind
    );
    if (!result?.memberAgentId) {
      throw new MemberAgentCommandError({
        code: result?.reasonCodes[0] ?? "member_agents.add_failed",
        message:
          result?.reasonCodes[0] ===
          MEMBER_AGENT_SYNC_HARNESS_NOT_DETECTED_REASON
            ? `None of your connected computers has ${formatHarnessDisplayName(harnessKind)} right now.`
            : `OpenMeld couldn't add ${formatHarnessDisplayName(harnessKind)}.`,
        nextStep: `Install the harness, keep OpenMeld Service running on your computer, or run \`openmeld agents enable --agent ${harnessKind}\` there, then try again.`,
        title: "Agent Not Added",
      });
    }
    if (presenter.view === "agent") {
      presenter.data({
        code: "member_agents.add",
        payload: {
          organizationId: response.organizationId,
          result,
        },
      });
      return;
    }
    renderInfoCard({
      codePrefix: "member_agents.add.card",
      minContentWidth: 64,
      presenter,
      rows: [
        { label: "Harness", value: formatHarnessDisplayName(harnessKind) },
        {
          label: "Status",
          value:
            result.outcome === "created"
              ? "Added. Its Direct Message is ready in OpenMeld."
              : "You already have this Agent.",
        },
        { label: "Agent ID", value: result.memberAgentId },
      ],
      sanitize: true,
      title: "Agent Added",
    });
  } catch (error) {
    emitMemberAgentCommandError({ error, presenter });
  }
}

export async function loadMemberAgentListingView(): Promise<MemberAgentListingView> {
  return (await loadMemberAgentListingContext()).view;
}

async function loadMemberAgentListingContext(
  input: { organization?: string } = {}
): Promise<{
  profiles: OpenMeldProfile[];
  view: MemberAgentListingView;
}> {
  if (!isMemberAgentsEnabled()) {
    throw new MemberAgentsDisabledError();
  }
  const [listing, profiles] = await Promise.all([
    readMemberAgentListing(input),
    listOpenMeldProfiles(),
  ]);
  return { profiles, view: buildMemberAgentListingView({ listing, profiles }) };
}

async function readProfileComputers(input: {
  memberAgent: MemberAgentView;
  profiles: readonly OpenMeldProfile[];
}): Promise<Map<string, MemberAgentProfileComputer>> {
  const entries = await Promise.all(
    input.memberAgent.profiles.map(
      async (summary): Promise<[string, MemberAgentProfileComputer]> => {
        const profile = input.profiles.find(
          (candidate) =>
            candidate.openMeldProfileId === summary.openMeldProfileId
        );
        if (!profile) {
          return [
            summary.openMeldProfileId,
            {
              message: "This Agent Profile is not in your Profile list.",
              status: "unreadable",
            },
          ];
        }
        try {
          const report = await resolveAgentProfilePrimaryAgentControllerReport({
            profile,
          });
          const runtimeId =
            report?.primaryBinding.executionTarget?.openMeldServiceRuntimeId
              .value;
          return [
            summary.openMeldProfileId,
            runtimeId
              ? { openMeldServiceRuntimeId: runtimeId, status: "bound" }
              : { status: "not_bound" },
          ];
        } catch (error) {
          return [
            summary.openMeldProfileId,
            {
              message: error instanceof Error ? error.message : String(error),
              status: "unreadable",
            },
          ];
        }
      }
    )
  );
  return new Map(entries);
}

function toMemberAgentPayload(memberAgent: MemberAgentView) {
  return {
    id: memberAgent.id,
    displayName: memberAgent.displayName,
    harnessKind: memberAgent.harnessKind,
    ownerUserId: memberAgent.ownerUserId,
    ownerName: memberAgent.ownerName,
    source: memberAgent.source,
    archived: memberAgent.archived,
    archivedAt: memberAgent.archivedAt,
    profileCount: memberAgent.profileCount,
    defaultProfile: memberAgent.defaultProfile,
  };
}

function buildMemberAgentListPayload(view: MemberAgentListingView) {
  return {
    organizationId: view.organizationId,
    memberAgents: view.memberAgents.map(toMemberAgentPayload),
    unassignedProfiles: view.unassignedProfiles,
  };
}

function renderMemberAgentList(input: {
  presenter: Presenter;
  view: MemberAgentListingView;
}): void {
  const { memberAgents, unassignedProfiles } = input.view;
  if (memberAgents.length === 0) {
    renderInfoCard({
      codePrefix: "member_agents.list.card",
      minContentWidth: 64,
      presenter: input.presenter,
      rows: [
        {
          label: "Status",
          value: "You have no Agents in this organization yet.",
        },
        {
          label: "Next Step",
          value:
            "Run `openmeld setup` on a computer with Claude Code, Codex, or another supported harness.",
        },
      ],
      sanitize: true,
      title: "No Agents Yet",
    });
  } else {
    renderInfoCard({
      codePrefix: "member_agents.list.card",
      minContentWidth: 64,
      presenter: input.presenter,
      rows: memberAgents.map((memberAgent) => ({
        label: memberAgent.displayName,
        value: formatMemberAgentListSummary(memberAgent),
      })),
      sanitize: true,
      title: `Agents (${memberAgents.length})`,
    });
  }
  if (unassignedProfiles.length > 0) {
    renderInfoCard({
      codePrefix: "member_agents.unassigned.card",
      minContentWidth: 64,
      presenter: input.presenter,
      rows: [
        ...unassignedProfiles.map((profile) => ({
          label: profile.profileName,
          value: `id: ${profile.openMeldProfileId}`,
        })),
        {
          label: "Why",
          value:
            "These Agent Profiles have no harness OpenMeld can group them under.",
        },
      ],
      sanitize: true,
      title: `Unassigned (${unassignedProfiles.length})`,
    });
  }
}

export function formatMemberAgentListSummary(
  memberAgent: MemberAgentView
): string {
  const profileCount =
    memberAgent.profileCount === 1
      ? "1 Profile"
      : `${memberAgent.profileCount} Profiles`;
  return [
    memberAgent.harnessKind,
    profileCount,
    `default: ${memberAgent.defaultProfile?.profileName ?? "none"}`,
    memberAgent.source,
    ...(memberAgent.archived ? ["archived"] : []),
    `id: ${memberAgent.id}`,
  ].join(" · ");
}

function renderMemberAgentDetail(input: {
  computers: Map<string, MemberAgentProfileComputer>;
  memberAgent: MemberAgentView;
  presenter: Presenter;
  unassignedProfileCount: number;
}): void {
  const { memberAgent } = input;
  renderInfoCard({
    codePrefix: "member_agents.show.card",
    minContentWidth: 64,
    presenter: input.presenter,
    rows: [
      { label: "Agent ID", value: memberAgent.id },
      {
        label: "Harness",
        value: `${memberAgent.harnessDisplayName} (${memberAgent.harnessKind})`,
      },
      { label: "Source", value: memberAgent.source },
      {
        label: "State",
        value: memberAgent.archived ? "Archived" : "Active",
      },
      ...memberAgent.profiles.map((profile) => ({
        label: profile.isDefault
          ? `${profile.profileName} (default)`
          : profile.profileName,
        value: `id: ${profile.openMeldProfileId} · ${formatProfileComputer(
          input.computers.get(profile.openMeldProfileId)
        )}`,
      })),
      ...(input.unassignedProfileCount > 0
        ? [
            {
              label: "Unassigned",
              value: `${input.unassignedProfileCount} Agent Profile${
                input.unassignedProfileCount === 1 ? " is" : "s are"
              } not grouped under an Agent. Run \`openmeld agent list\` to see unassigned Profiles.`,
            },
          ]
        : []),
    ],
    sanitize: true,
    title: memberAgent.displayName,
  });
}

function formatProfileComputer(
  computer: MemberAgentProfileComputer | undefined
): string {
  if (!computer || computer.status === "unreadable") {
    return "computer: unavailable";
  }
  if (computer.status === "not_bound") {
    return "computer: not connected";
  }
  return `computer: ${computer.openMeldServiceRuntimeId}`;
}

export function emitMemberAgentCommandError(input: {
  error: unknown;
  presenter: Presenter;
}): void {
  const { error } = input;
  if (!(error instanceof MemberAgentCommandError)) {
    throw error;
  }
  process.exitCode = 1;
  if (input.presenter.view === "agent") {
    input.presenter.event(
      "error",
      "member_agents.error",
      {
        error: {
          code: error.code,
          message: error.message,
          nextStep: error.nextStep,
        },
        message: error.message,
        status: "error",
      },
      { code: error.code }
    );
    return;
  }
  renderHumanErrorCard({
    codePrefix: "member_agents.error.card",
    message: error.message,
    nextStep: error.nextStep,
    presenter: input.presenter,
    title: error.title,
  });
}

class MemberAgentHarnessMismatchError extends MemberAgentCommandError {
  constructor(input: { memberAgent: MemberAgentView; requested: string }) {
    super({
      code: "member_agents.harness_mismatch",
      message: `${input.memberAgent.displayName} runs ${input.memberAgent.harnessDisplayName}, so its Agent Profiles can't use ${input.requested}.`,
      nextStep: `Leave out --agent-controller, or pass --agent-controller ${formatHarnessAgentControllerRef(input.memberAgent.harnessKind)}.`,
      title: "Harness Doesn't Match",
    });
  }
}

export function formatHarnessAgentControllerRef(
  harnessKind: MemberAgentView["harnessKind"]
): string {
  return harnessKind === HOSTED_HARNESS_KIND
    ? HOSTED_REMOTE_AGENT_CONTROLLER_REF
    : `builtin:${harnessKind}`;
}

/**
 * `profiles create --member-agent`: the new Profile must use the parent's
 * harness. Returns the Agent Controller to create with (the parent's harness
 * when none was given), or null after reporting why creation was refused.
 */
export async function resolveProfileCreateMemberAgentController(input: {
  agentController?: string;
  memberAgent: string;
  organization?: string;
  view?: string;
}): Promise<string | null> {
  const runtime = await resolveRuntimeContext({ view: input.view });
  const presenter = createPresenter(runtime);
  try {
    const { view } = await loadMemberAgentListingContext({
      ...(input.organization ? { organization: input.organization } : {}),
    });
    const memberAgent = findMemberAgentView({
      selector: input.memberAgent,
      view,
    });
    if (!memberAgent) {
      throw new MemberAgentNotFoundError(input.memberAgent);
    }
    const requested = input.agentController?.trim();
    if (!requested) {
      return formatHarnessAgentControllerRef(memberAgent.harnessKind);
    }
    if (
      harnessKindFromAgentControllerRef(requested) !== memberAgent.harnessKind
    ) {
      throw new MemberAgentHarnessMismatchError({ memberAgent, requested });
    }
    return requested;
  } catch (error) {
    emitMemberAgentCommandError({ error, presenter });
    return null;
  }
}
