import { createOrganizationApi } from "@openmeld/api-client";
import type {
  CenterAgentDesignation,
  DesignateCenterAgentResponse,
  GetCenterAgentDesignationResponse,
  GetCenterAgentOperatingStateResponse,
  ListCenterAgentAuditJournalResponse,
  OrganizationDirectoryAgentProfile,
  UpdateCenterAgentOperatingStateResponse,
} from "@openmeld/schemas/types";
import type { StoredActiveOrganization } from "../config/auth-session";
import { resolveBaseUrl } from "../config/base-url";
import type { Presenter } from "../runtime/presenter/types";
import type { RuntimeContext } from "../runtime/types";
import { createCliApiClientFoundation } from "../space/api-client-foundation";
import { renderInfoCard } from "../ui/info-card";
import { colorizeAgentLabel } from "../ui/profile-label-color";
import {
  createCenterAgentApiClient,
  resolveCenterAgentCommandContext,
} from "./command-context";
import { emitCenterAgentApiError, emitCenterAgentCommandError } from "./errors";
import { formatOrganizationLabel } from "./presentation";

type CenterAgentAuditJournalEntry =
  ListCenterAgentAuditJournalResponse["entries"][number];

type CenterAgentStatusProfile = {
  profileId: string;
  profileName: string;
  agentControllerRef: string | null;
};

const CENTER_AGENT_NO_DESIGNATION_NEXT_STEP =
  "Run `openmeld center-agent designate <agent-profile-id>` after connecting an Agent Profile you own.";

export async function runCenterAgentStatus(input?: {
  view?: string;
}): Promise<void> {
  const context = await resolveCenterAgentCommandContext(input);
  if (!context) {
    return;
  }

  try {
    const api = await createCenterAgentApiClient();
    const response = await api.getDesignation();
    const operatingState = response.designation
      ? await api.getOperatingState()
      : null;
    const profile = response.designation
      ? await loadCenterAgentProfileOrThrow(response.designation.agentProfileId)
      : null;
    emitCenterAgentStatusSuccess({
      activeOrganization: context.activeOrganization,
      operatingState,
      presenter: context.presenter,
      profile,
      response,
      runtime: context.runtime,
    });
  } catch (error) {
    emitCenterAgentApiError({
      activeOrganization: context.activeOrganization,
      error,
      operation: "status",
      presenter: context.presenter,
    });
  }
}

export async function runCenterAgentDesignate(input: {
  agentProfileId?: string;
  view?: string;
}): Promise<void> {
  const context = await resolveCenterAgentCommandContext(input);
  if (!context) {
    return;
  }

  const agentProfileId = normalizeAgentProfileId(input.agentProfileId);
  if (!agentProfileId) {
    emitCenterAgentCommandError({
      activeOrganization: context.activeOrganization,
      code: "center_agent.agent_profile_required",
      title: "Agent Profile Required",
      message: "Choose the Agent Profile to designate as the Center Agent.",
      nextStep: "Run `openmeld center-agent designate <agent-profile-id>`.",
      presenter: context.presenter,
    });
    return;
  }

  try {
    const api = await createCenterAgentApiClient();
    const response = await api.designate({ agentProfileId });
    emitCenterAgentDesignateSuccess({
      activeOrganization: context.activeOrganization,
      presenter: context.presenter,
      response,
      runtime: context.runtime,
    });
  } catch (error) {
    emitCenterAgentApiError({
      activeOrganization: context.activeOrganization,
      agentProfileId,
      error,
      operation: "designate",
      presenter: context.presenter,
    });
  }
}

export async function runCenterAgentPause(input?: {
  view?: string;
}): Promise<void> {
  await runCenterAgentOperatingStateChange({
    ...input,
    operatingState: "paused",
  });
}

export async function runCenterAgentResume(input?: {
  view?: string;
}): Promise<void> {
  await runCenterAgentOperatingStateChange({
    ...input,
    operatingState: "active",
  });
}

async function runCenterAgentOperatingStateChange(input: {
  operatingState: "active" | "paused";
  view?: string;
}): Promise<void> {
  const context = await resolveCenterAgentCommandContext(input);
  if (!context) {
    return;
  }

  const operation = input.operatingState === "paused" ? "pause" : "resume";
  try {
    const api = await createCenterAgentApiClient();
    const response = await api.updateOperatingState({
      operatingState: input.operatingState,
    });
    emitCenterAgentOperatingStateSuccess({
      activeOrganization: context.activeOrganization,
      operation,
      presenter: context.presenter,
      response,
      runtime: context.runtime,
    });
  } catch (error) {
    emitCenterAgentApiError({
      activeOrganization: context.activeOrganization,
      error,
      operation,
      presenter: context.presenter,
    });
  }
}

export async function runCenterAgentAudit(input?: {
  limit?: number;
  view?: string;
}): Promise<void> {
  const context = await resolveCenterAgentCommandContext(input);
  if (!context) {
    return;
  }

  const limit = normalizeAuditLimit(input?.limit);
  if (limit === "invalid") {
    emitCenterAgentCommandError({
      activeOrganization: context.activeOrganization,
      code: "center_agent.audit_limit_invalid",
      title: "Audit Limit Invalid",
      message: "Center Agent audit limit must be between 1 and 200.",
      nextStep: "Run `openmeld center-agent audit --limit 25`.",
      presenter: context.presenter,
    });
    return;
  }

  try {
    const api = await createCenterAgentApiClient();
    const response = await api.listAuditJournal(
      limit === undefined ? {} : { limit }
    );
    emitCenterAgentAuditSuccess({
      activeOrganization: context.activeOrganization,
      entries: response.entries,
      organizationId: response.organizationId,
      presenter: context.presenter,
      runtime: context.runtime,
    });
  } catch (error) {
    emitCenterAgentApiError({
      activeOrganization: context.activeOrganization,
      error,
      operation: "audit",
      presenter: context.presenter,
    });
  }
}

async function createOrganizationApiClient() {
  return createOrganizationApi(
    createCliApiClientFoundation(await resolveBaseUrl())
  );
}

async function loadCenterAgentProfileOrThrow(
  agentProfileId: string
): Promise<CenterAgentStatusProfile> {
  const api = await createOrganizationApiClient();
  const directory = await api.getCurrentDirectory();
  const profile = directory.agentProfiles.find(
    (candidate) => candidate.profileId === agentProfileId
  );
  if (!profile) {
    const error = new Error(
      "Center Agent designation profile is missing from the Organization directory."
    ) as Error & {
      code?: string;
      status?: number;
    };
    error.code = "center_agent.profile_details_missing";
    error.status = 409;
    throw error;
  }
  return toCenterAgentStatusProfile(profile);
}

function toCenterAgentStatusProfile(
  profile: OrganizationDirectoryAgentProfile
): CenterAgentStatusProfile {
  return {
    agentControllerRef: profile.readiness.agentControllerRef ?? null,
    profileId: profile.profileId,
    profileName: profile.profileName,
  };
}

function emitCenterAgentStatusSuccess(input: {
  activeOrganization: StoredActiveOrganization;
  operatingState: GetCenterAgentOperatingStateResponse | null;
  presenter: Presenter;
  profile: CenterAgentStatusProfile | null;
  response: GetCenterAgentDesignationResponse;
  runtime: RuntimeContext;
}): void {
  const payload = buildCenterAgentStatusPayload({
    activeOrganization: input.activeOrganization,
    operatingState: input.operatingState,
    profile: input.profile,
    response: input.response,
  });

  if (input.runtime.resolvedView === "human") {
    renderCenterAgentStatusCard({
      activeOrganization: input.activeOrganization,
      designation: input.response.designation,
      operatingState: input.operatingState,
      presenter: input.presenter,
      profile: input.profile,
    });
    return;
  }

  input.presenter.data({
    code: "center_agent.status",
    payload,
  });
}

function emitCenterAgentDesignateSuccess(input: {
  activeOrganization: StoredActiveOrganization;
  presenter: Presenter;
  response: DesignateCenterAgentResponse;
  runtime: RuntimeContext;
}): void {
  const payload = {
    status: "ok",
    organization: {
      active: input.activeOrganization,
    },
    centerAgent: {
      designation: input.response.designation,
      designationStatus: input.response.status,
      profile: {
        profileId: input.response.designation.agentProfileId,
      },
    },
  };

  if (input.runtime.resolvedView === "human") {
    renderCenterAgentDesignationCard({
      activeOrganization: input.activeOrganization,
      presenter: input.presenter,
      response: input.response,
    });
    return;
  }

  input.presenter.data({
    code: "center_agent.designate",
    payload,
  });
}

function emitCenterAgentOperatingStateSuccess(input: {
  activeOrganization: StoredActiveOrganization;
  operation: "pause" | "resume";
  presenter: Presenter;
  response: UpdateCenterAgentOperatingStateResponse;
  runtime: RuntimeContext;
}): void {
  const payload = {
    status: "ok",
    organization: {
      active: input.activeOrganization,
    },
    operatingState: input.response,
  };

  if (input.runtime.resolvedView === "human") {
    renderCenterAgentOperatingStateCard({
      activeOrganization: input.activeOrganization,
      operation: input.operation,
      presenter: input.presenter,
      response: input.response,
    });
    return;
  }

  input.presenter.data({
    code: `center_agent.${input.operation}`,
    payload,
  });
}

function emitCenterAgentAuditSuccess(input: {
  activeOrganization: StoredActiveOrganization;
  entries: CenterAgentAuditJournalEntry[];
  organizationId: string;
  presenter: Presenter;
  runtime: RuntimeContext;
}): void {
  const payload = {
    status: "ok",
    organization: {
      active: input.activeOrganization,
    },
    organizationId: input.organizationId,
    entries: input.entries,
  };

  if (input.runtime.resolvedView === "human") {
    renderCenterAgentAuditCard({
      activeOrganization: input.activeOrganization,
      entries: input.entries,
      organizationId: input.organizationId,
      presenter: input.presenter,
    });
    return;
  }

  input.presenter.data({
    code: "center_agent.audit",
    payload,
  });
}

function renderCenterAgentStatusCard(input: {
  activeOrganization: StoredActiveOrganization;
  designation: CenterAgentDesignation | null;
  operatingState: GetCenterAgentOperatingStateResponse | null;
  presenter: Presenter;
  profile: CenterAgentStatusProfile | null;
}): void {
  if (!input.designation) {
    renderInfoCard({
      codePrefix: "center-agent.status.card",
      minContentWidth: 72,
      presenter: input.presenter,
      rows: [
        {
          label: "Organization",
          value: formatOrganizationLabel(input.activeOrganization),
        },
        { label: "Status", value: "No Center Agent is designated." },
        { label: "Next Step", value: CENTER_AGENT_NO_DESIGNATION_NEXT_STEP },
      ],
      sanitize: true,
      title: "No Center Agent Designated",
    });
    return;
  }

  renderInfoCard({
    codePrefix: "center-agent.status.card",
    minContentWidth: 72,
    presenter: input.presenter,
    rows: [
      {
        label: "Organization",
        value: formatOrganizationLabel(input.activeOrganization),
      },
      {
        label: "Center Agent",
        value: input.profile
          ? formatCenterAgentProfileLabel(input.profile)
          : input.designation.agentProfileId,
      },
      { label: "Agent Profile ID", value: input.designation.agentProfileId },
      {
        label: "Operating State",
        value: input.operatingState?.operatingState ?? "unknown",
      },
      {
        label: "Designated By",
        value: input.designation.designatedBy ?? "Deleted member",
      },
      { label: "Created At", value: input.designation.createdAt },
    ],
    sanitize: true,
    title: "Center Agent",
  });
}

function renderCenterAgentDesignationCard(input: {
  activeOrganization: StoredActiveOrganization;
  presenter: Presenter;
  response: DesignateCenterAgentResponse;
}): void {
  renderInfoCard({
    codePrefix: "center-agent.designate.card",
    minContentWidth: 72,
    presenter: input.presenter,
    rows: [
      {
        label: "Organization",
        value: formatOrganizationLabel(input.activeOrganization),
      },
      {
        label: "Agent Profile ID",
        value: input.response.designation.agentProfileId,
      },
      { label: "Status", value: input.response.status },
      {
        label: "Result",
        value: `This Agent Profile is now the Center Agent for ${input.activeOrganization.name}.`,
      },
      {
        label: "Designated By",
        value: input.response.designation.designatedBy ?? "Deleted member",
      },
      { label: "Created At", value: input.response.designation.createdAt },
    ],
    sanitize: true,
    title: resolveDesignationTitle(input.response.status),
  });
}

function renderCenterAgentOperatingStateCard(input: {
  activeOrganization: StoredActiveOrganization;
  operation: "pause" | "resume";
  presenter: Presenter;
  response: UpdateCenterAgentOperatingStateResponse;
}): void {
  renderInfoCard({
    codePrefix: `center-agent.${input.operation}.card`,
    minContentWidth: 72,
    presenter: input.presenter,
    rows: [
      {
        label: "Organization",
        value: formatOrganizationLabel(input.activeOrganization),
      },
      { label: "Operating State", value: input.response.operatingState },
      { label: "Changed", value: input.response.changed ? "yes" : "no" },
      {
        label: "Current Tasks Stopped",
        value: String(input.response.affectedTaskCount),
      },
      ...(input.response.pausedAt
        ? [{ label: "Paused At", value: input.response.pausedAt }]
        : []),
    ],
    sanitize: true,
    title:
      input.operation === "pause"
        ? "Center Agent Paused"
        : "Center Agent Resumed",
  });
}

function renderCenterAgentAuditCard(input: {
  activeOrganization: StoredActiveOrganization;
  entries: CenterAgentAuditJournalEntry[];
  organizationId: string;
  presenter: Presenter;
}): void {
  renderInfoCard({
    codePrefix: "center-agent.audit.card",
    minContentWidth: 72,
    presenter: input.presenter,
    rows: [
      {
        label: "Organization",
        value: formatOrganizationLabel(input.activeOrganization),
      },
      { label: "Organization ID", value: input.organizationId },
      { label: "Audit Entries", value: String(input.entries.length) },
      ...input.entries.map((entry) => ({
        label: "Entry",
        value: formatAuditEntry(entry),
      })),
    ],
    sanitize: true,
    title: "Center Agent Audit",
  });
}

function buildCenterAgentStatusPayload(input: {
  activeOrganization: StoredActiveOrganization;
  operatingState: GetCenterAgentOperatingStateResponse | null;
  profile: CenterAgentStatusProfile | null;
  response: GetCenterAgentDesignationResponse;
}) {
  return {
    status: "ok",
    organization: {
      active: input.activeOrganization,
    },
    centerAgent: {
      designated: input.response.designation !== null,
      designation: input.response.designation,
      operatingState: input.operatingState,
      profile: input.profile
        ? {
            profileId: input.profile.profileId,
            profileName: input.profile.profileName,
          }
        : null,
      ...(input.response.designation
        ? {}
        : { nextStep: CENTER_AGENT_NO_DESIGNATION_NEXT_STEP }),
    },
  };
}

function formatCenterAgentProfileLabel(
  profile: CenterAgentStatusProfile
): string {
  const label = colorizeAgentLabel(profile.profileName, {
    ...(profile.agentControllerRef
      ? { agentControllerRef: profile.agentControllerRef }
      : {}),
    profileId: profile.profileId,
    profileName: profile.profileName,
  });
  return `${label} (${profile.profileId})`;
}

function formatAuditEntry(entry: CenterAgentAuditJournalEntry): string {
  return [
    formatCenterAgentAction(entry.action),
    `actor ${entry.actorProfileId}`,
    `on behalf of ${formatOnBehalfOf(entry.onBehalfOf)}`,
    entry.createdAt,
  ].join(" | ");
}

function formatOnBehalfOf(
  onBehalfOf: CenterAgentAuditJournalEntry["onBehalfOf"]
): string {
  if (!onBehalfOf) {
    return "none";
  }
  return `${onBehalfOf.displayName} (${onBehalfOf.profileId})`;
}

function formatCenterAgentAction(action: string): string {
  return action.replaceAll("_", " ");
}

function resolveDesignationTitle(
  status: DesignateCenterAgentResponse["status"]
): string {
  if (status === "replaced") {
    return "Center Agent Replaced";
  }
  if (status === "unchanged") {
    return "Center Agent Unchanged";
  }
  return "Center Agent Designated";
}

function normalizeAgentProfileId(value: unknown): string | null {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeAuditLimit(
  value: number | undefined
): number | undefined | "invalid" {
  if (value === undefined) {
    return undefined;
  }
  if (!Number.isInteger(value) || value < 1 || value > 200) {
    return "invalid";
  }
  return value;
}
