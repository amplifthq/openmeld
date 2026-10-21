import { confirm, isCancel } from "@clack/prompts";
import {
  createDirectMessageApi,
  type DirectMessageApi,
  toStructuredApiClientFailure,
} from "@openmeld/api-client";
import {
  type AgentDirectMessageSession,
  agentDirectMessageSessionSelectorSchema,
  MAX_SPACE_NAME_LENGTH,
  MEMBER_AGENTS_DISABLED_CODE,
  spaceNameSchema,
  type UpdateAgentDirectMessageSessionResponse,
} from "@openmeld/schemas";
import { createAuthenticationError } from "../auth/auth-guidance";
import { getAuthSessionState } from "../config/auth-session";
import { resolveBaseUrl } from "../config/base-url";
import { resolveRuntimeContext } from "../runtime/context";
import { canUseInteractivePrompts } from "../runtime/interaction";
import { createPresenter } from "../runtime/presenter/index";
import type { Presenter } from "../runtime/presenter/types";
import { createCliApiClientFoundation } from "../space/api-client-foundation";
import { renderInfoCard } from "../ui/info-card";
import {
  emitMemberAgentCommandError,
  loadMemberAgentListingView,
  MemberAgentNotFoundError,
} from "./command";
import {
  findMemberAgentView,
  isMemberAgentsEnabled,
  MemberAgentCommandError,
  MemberAgentsDisabledError,
  type MemberAgentView,
} from "./read";

// `openmeld session …`: the Direct Message Sessions of a MemberAgent's
// Profiles for the signed-in member (MemberAgent program, package 1g). One
// Session is one Direct Message Space. Core owns authorization; the CLI only
// validates input shape and maps refusals to one next step.

const SESSION_LIST_NEXT_STEP =
  "Run `openmeld session list --agent <agent>` and copy a Session ID.";
const ORGANIZATION_NEXT_STEP =
  "Run `openmeld org switch <slug>` to choose an organization, then try again.";
const DEFAULT_SESSION_LIST_LIMIT = 20;

type SessionState = "active" | "archived";

export type SessionListProfileGroup = {
  openMeldProfileId: string;
  profileName: string;
  isDefault: boolean;
  sessions: SessionListRow[];
  /** True when either state has more Sessions than the requested limit. */
  hasMore: boolean;
};

type SessionListRow = {
  spaceId: string;
  title: string | null;
  state: SessionState;
  createdAt: string | null;
  archivedAt: string | null;
  lastActivityAt: string | null;
};

export async function runSessionList(input: {
  memberAgent: string;
  profile?: string;
  limit?: string;
  view?: string;
}): Promise<void> {
  const runtime = await resolveRuntimeContext({ view: input.view });
  const presenter = createPresenter(runtime);
  try {
    if (!isMemberAgentsEnabled()) {
      throw new MemberAgentsDisabledError();
    }
    const limit = parseSessionListLimit(input.limit);
    const view = await loadMemberAgentListingView();
    const memberAgent = findMemberAgentView({
      selector: input.memberAgent,
      view,
    });
    if (!memberAgent) {
      throw new MemberAgentNotFoundError(input.memberAgent);
    }
    const profiles = selectProfiles({ memberAgent, profile: input.profile });
    const { api } = await createSessionsApi();
    const groups = await Promise.all(
      profiles.map((profile) =>
        readProfileSessions({ api, limit, memberAgent, profile })
      )
    );
    if (presenter.view === "agent") {
      presenter.data({
        code: "member_agents.sessions.list",
        payload: {
          organizationId: view.organizationId,
          memberAgent: {
            id: memberAgent.id,
            displayName: memberAgent.displayName,
            harnessKind: memberAgent.harnessKind,
          },
          profiles: groups,
        },
      });
      return;
    }
    renderSessionList({ groups, memberAgent, presenter });
  } catch (error) {
    emitMemberAgentCommandError({ error: toSessionError(error), presenter });
  }
}

export async function runSessionRename(input: {
  spaceId: string;
  title: string;
  view?: string;
}): Promise<void> {
  const title = spaceNameSchema.safeParse(input.title);
  await runSessionUpdate({
    ...input,
    code: "member_agents.sessions.rename",
    heading: "Session Renamed",
    update: () => {
      if (!title.success) {
        throw new MemberAgentCommandError({
          code: "member_agents.sessions.invalid_title",
          message: `A Session title needs 1 to ${MAX_SPACE_NAME_LENGTH} characters.`,
          nextStep: "Run the command again with a shorter, non-empty title.",
          title: "Title Not Valid",
        });
      }
      return { operation: "rename", name: title.data };
    },
  });
}

export async function runSessionArchive(input: {
  spaceId: string;
  view?: string;
}): Promise<void> {
  await runSessionUpdate({
    ...input,
    code: "member_agents.sessions.archive",
    heading: "Session Archived",
    update: () => ({ operation: "archive" }),
  });
}

export async function runSessionRestore(input: {
  spaceId: string;
  view?: string;
}): Promise<void> {
  await runSessionUpdate({
    ...input,
    code: "member_agents.sessions.restore",
    heading: "Session Restored",
    update: () => ({ operation: "unarchive" }),
  });
}

export async function runSessionDelete(input: {
  spaceId: string;
  yes?: boolean;
  view?: string;
}): Promise<void> {
  const runtime = await resolveRuntimeContext({ view: input.view });
  const presenter = createPresenter(runtime);
  try {
    if (!isMemberAgentsEnabled()) {
      throw new MemberAgentsDisabledError();
    }
    const spaceId = requireSessionId(input.spaceId);
    if (input.yes !== true) {
      if (!canUseInteractivePrompts(runtime)) {
        throw new MemberAgentCommandError({
          code: "member_agents.sessions.delete_confirmation_required",
          message: "Deleting a Session needs explicit confirmation.",
          nextStep: `Run \`openmeld session delete ${spaceId} --yes\`.`,
          title: "Confirmation Required",
        });
      }
      const confirmed = await confirm({
        initialValue: false,
        message: `Permanently delete Session ${spaceId} and its messages?`,
      });
      if (isCancel(confirmed) || !confirmed) {
        presenter.line({
          code: "member_agents.sessions.delete.cancelled",
          text: "Deletion canceled. The Session was not changed.",
        });
        return;
      }
    }
    const { api } = await createSessionsApi();
    const response = await callSessionRoute(() =>
      api.deleteSession({ spaceId })
    );
    if (presenter.view === "agent") {
      presenter.data({
        code: "member_agents.sessions.delete",
        payload: response,
      });
      return;
    }
    renderInfoCard({
      codePrefix: "member_agents.sessions.delete.card",
      minContentWidth: 64,
      presenter,
      rows: [
        { label: "Session ID", value: response.spaceId },
        { label: "Status", value: "Deleted with its messages." },
      ],
      sanitize: true,
      title: "Session Deleted",
    });
  } catch (error) {
    emitMemberAgentCommandError({ error: toSessionError(error), presenter });
  }
}

async function runSessionUpdate(input: {
  spaceId: string;
  view?: string;
  code: string;
  heading: string;
  update: () =>
    | { operation: "rename"; name: string }
    | { operation: "archive" }
    | { operation: "unarchive" };
}): Promise<void> {
  const runtime = await resolveRuntimeContext({ view: input.view });
  const presenter = createPresenter(runtime);
  try {
    if (!isMemberAgentsEnabled()) {
      throw new MemberAgentsDisabledError();
    }
    const spaceId = requireSessionId(input.spaceId);
    const update = input.update();
    const { api } = await createSessionsApi();
    const response = await callSessionRoute(() =>
      api.updateSession({ spaceId, update })
    );
    if (presenter.view === "agent") {
      presenter.data({
        code: input.code,
        payload: {
          ...response,
          state: response.archivedAt === null ? "active" : "archived",
        },
      });
      return;
    }
    renderSessionMutation({
      code: input.code,
      heading: input.heading,
      presenter,
      response,
    });
  } catch (error) {
    emitMemberAgentCommandError({ error: toSessionError(error), presenter });
  }
}

/**
 * The Gateway client for the active Organization. Checked after the release
 * flag so a flag-off command never reads auth state or calls a route.
 */
async function createSessionsApi(): Promise<{
  api: DirectMessageApi;
  organizationId: string;
}> {
  const auth = await getAuthSessionState({ validateRemote: false });
  if (auth.state !== "valid" || !auth.session) {
    throw createAuthenticationError({ reason: "required" });
  }
  const organizationId = auth.session.activeOrganization?.id;
  if (!organizationId) {
    throw new MemberAgentCommandError({
      code: "member_agents.organization_required",
      message: "Choose an organization to see its Sessions.",
      nextStep: ORGANIZATION_NEXT_STEP,
      title: "Organization Required",
    });
  }
  return {
    api: createDirectMessageApi(
      createCliApiClientFoundation(await resolveBaseUrl(), { organizationId })
    ),
    organizationId,
  };
}

function selectProfiles(input: {
  memberAgent: MemberAgentView;
  profile?: string;
}): MemberAgentView["profiles"] {
  const selector = input.profile?.trim();
  if (!selector) {
    return input.memberAgent.profiles;
  }
  const profile = input.memberAgent.profiles.find(
    (candidate) => candidate.openMeldProfileId === selector
  );
  if (!profile) {
    throw new MemberAgentCommandError({
      code: "member_agents.sessions.profile_not_found",
      message: `${input.memberAgent.displayName} has no Agent Profile "${selector}".`,
      nextStep: `Run \`openmeld agent show ${input.memberAgent.id}\` and copy one of its Profile IDs.`,
      title: "Profile Not Found",
    });
  }
  return [profile];
}

async function readProfileSessions(input: {
  api: DirectMessageApi;
  limit: number;
  memberAgent: MemberAgentView;
  profile: MemberAgentView["profiles"][number];
}): Promise<SessionListProfileGroup> {
  const agentProfileId = input.profile.openMeldProfileId;
  const [active, archived] = await callSessionRoute(() =>
    Promise.all([
      input.api.listSessions({
        agentProfileId,
        archived: false,
        limit: input.limit,
      }),
      input.api.listSessions({
        agentProfileId,
        archived: true,
        limit: input.limit,
      }),
    ])
  );
  return {
    openMeldProfileId: agentProfileId,
    profileName: input.profile.profileName,
    isDefault: input.profile.isDefault,
    sessions: [...active.sessions, ...archived.sessions].map(toSessionRow),
    hasMore: active.nextCursor !== null || archived.nextCursor !== null,
  };
}

function toSessionRow(session: AgentDirectMessageSession): SessionListRow {
  const previewAt = session.messagePreview?.timestamp;
  return {
    spaceId: session.spaceId,
    title: session.name,
    state: session.archivedAt === null ? "active" : "archived",
    createdAt: session.createdAt,
    archivedAt: session.archivedAt,
    lastActivityAt:
      previewAt === undefined
        ? session.createdAt
        : new Date(previewAt).toISOString(),
  };
}

function renderSessionList(input: {
  groups: SessionListProfileGroup[];
  memberAgent: MemberAgentView;
  presenter: Presenter;
}): void {
  for (const group of input.groups) {
    const profileLabel = group.isDefault
      ? `${group.profileName} (default)`
      : group.profileName;
    renderInfoCard({
      codePrefix: "member_agents.sessions.list.card",
      minContentWidth: 64,
      presenter: input.presenter,
      rows:
        group.sessions.length === 0
          ? [
              {
                label: "Status",
                value: "No Sessions with this Agent Profile yet.",
              },
              {
                label: "Next Step",
                value: `Open a Direct Message with ${group.profileName} in OpenMeld to start one.`,
              },
            ]
          : [
              ...group.sessions.map((session) => ({
                label: session.title ?? "Untitled Session",
                value: formatSessionRow(session),
              })),
              ...(group.hasMore
                ? [
                    {
                      label: "More",
                      value:
                        "Only the newest Sessions are shown. Pass --limit (up to 100) to see more.",
                    },
                  ]
                : []),
            ],
      sanitize: true,
      title: `${input.memberAgent.displayName} · ${profileLabel} (${group.sessions.length})`,
    });
  }
}

function formatSessionRow(session: SessionListRow): string {
  return [
    session.state === "active" ? "Active" : "Archived",
    `last activity: ${formatTimestamp(session.lastActivityAt)}`,
    `id: ${session.spaceId}`,
  ].join(" · ");
}

function formatTimestamp(value: string | null): string {
  if (!value) {
    return "unknown";
  }
  return `${value.slice(0, 16).replace("T", " ")} UTC`;
}

function renderSessionMutation(input: {
  code: string;
  heading: string;
  presenter: Presenter;
  response: UpdateAgentDirectMessageSessionResponse;
}): void {
  renderInfoCard({
    codePrefix: `${input.code}.card`,
    minContentWidth: 64,
    presenter: input.presenter,
    rows: [
      { label: "Session ID", value: input.response.spaceId },
      { label: "Title", value: input.response.name ?? "Untitled Session" },
      {
        label: "State",
        value: input.response.archivedAt === null ? "Active" : "Archived",
      },
    ],
    sanitize: true,
    title: input.heading,
  });
}

function parseSessionListLimit(value: string | undefined): number {
  if (value === undefined) {
    return DEFAULT_SESSION_LIST_LIMIT;
  }
  const limit = Number(value);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new MemberAgentCommandError({
      code: "member_agents.sessions.invalid_limit",
      message: "--limit must be a whole number from 1 to 100.",
      nextStep: "Run the command again with --limit 20, for example.",
      title: "Limit Not Valid",
    });
  }
  return limit;
}

function requireSessionId(value: string): string {
  const parsed = agentDirectMessageSessionSelectorSchema.safeParse({
    spaceId: value,
  });
  if (!parsed.success) {
    throw new MemberAgentCommandError({
      code: "member_agents.sessions.invalid_id",
      message: "Provide a valid Session ID.",
      nextStep: SESSION_LIST_NEXT_STEP,
      title: "Session ID Not Valid",
    });
  }
  return parsed.data.spaceId;
}

/** Marks a Gateway failure so only route errors are mapped below. */
class SessionRouteError extends Error {
  readonly failure: unknown;

  constructor(failure: unknown) {
    super(failure instanceof Error ? failure.message : String(failure));
    this.name = "SessionRouteError";
    this.failure = failure;
  }
}

async function callSessionRoute<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (error) {
    throw new SessionRouteError(error);
  }
}

/**
 * Keeps Core's error code and message and adds one next step. Core decides
 * who may see or change a Session; the CLI never retries as someone else.
 */
function toSessionError(error: unknown): unknown {
  if (!(error instanceof SessionRouteError)) {
    return error;
  }
  const failure = toStructuredApiClientFailure(error.failure);
  const code = failure.code ?? "member_agents.sessions.request_failed";
  if (code === MEMBER_AGENTS_DISABLED_CODE) {
    return new MemberAgentsDisabledError();
  }
  if (code === "direct_message_session.not_found") {
    return new MemberAgentCommandError({
      code,
      message: failure.message,
      nextStep: SESSION_LIST_NEXT_STEP,
      title: "Session Not Found",
    });
  }
  if (code === "direct_message_session.forbidden") {
    return new MemberAgentCommandError({
      code,
      message: failure.message,
      nextStep: `Only the person in a Direct Message can change its Sessions. ${SESSION_LIST_NEXT_STEP}`,
      title: "Not Your Session",
    });
  }
  if (code === "direct_message_session.agent_not_found") {
    return new MemberAgentCommandError({
      code,
      message: failure.message,
      nextStep:
        "Run `openmeld agent show <agent>` and copy a current Profile ID.",
      title: "Agent Profile Not Found",
    });
  }
  return new MemberAgentCommandError({
    code,
    message: failure.message,
    nextStep: "Try again. If it keeps failing, run `openmeld doctor`.",
    title: "Sessions Unavailable",
  });
}
