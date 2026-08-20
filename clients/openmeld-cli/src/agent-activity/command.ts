import { homedir } from "node:os";
import {
  createAgentActivityApi,
  createProjectsApi,
} from "@openmeld/api-client";
import {
  agentActivityInventorySessionOriginSchema,
  agentActivityInventorySessionStatusSchema,
  agentActivitySessionInventoryQuerySchema,
  agentActivitySessionStatusSchema,
  agentActivitySnapshotQuerySchema,
  cliJsonOutputEnvelopeSchema,
  localAgentSessionProviderSchema,
} from "@openmeld/schemas";
import type {
  AgentActivityProvider,
  AgentActivitySessionInventoryResponse,
  AgentActivitySnapshotResponse,
  Project,
} from "@openmeld/schemas/types";
import { getAuthSessionState } from "../config/auth-session";
import { resolveBaseUrl } from "../config/base-url";
import { resolveOpenMeldRootDir } from "../config/paths";
import {
  LocalProjectConnectionError,
  validateLocalProjectConnectionPath,
} from "../local-service/projects/local-project-connection";
import { emitCliErrorJson } from "../runtime/cli-error-json";
import { emitCliJsonEnvelope } from "../runtime/cli-json-output";
import { parseCliViewMode, resolveRuntimeContext } from "../runtime/context";
import { createPresenter } from "../runtime/presenter";
import type { Presenter } from "../runtime/presenter/types";
import { createCliApiClientFoundation } from "../space/api-client-foundation";
import { renderInfoCard } from "../ui/info-card";
import { removeProjectInbox } from "./hook-inbox";
import { removeAgentActivityContextCache } from "./local-context-cache";
import { removeProjectOutbox } from "./local-event-store";
import {
  defaultManagedIntegrationPaths,
  installAgentActivityIntegrations,
  resolveAgentActivityDispatcherCommand,
} from "./managed-integrations";
import {
  assertProjectBindingProducerCompatible,
  isProjectBindingUpdateRequiredError,
} from "./project-binding-producer-gate";
import {
  bindProject,
  listProjectBindings,
  listProjectConnectionsWithStatus,
  unbindProject,
} from "./project-bindings";
import {
  registerAgentActivityRoute,
  unregisterAgentActivityRoute,
} from "./route-registry";

type CommandInput = { json?: boolean; view?: string };

export async function runProjectsList(input: CommandInput = {}): Promise<void> {
  await runProjectCommand(input, "list", async (context) => {
    const [response, connections] = await Promise.all([
      context.projectsApi.list(),
      listProjectConnectionsWithStatus({
        organizationId: context.organizationId,
      }),
    ]);
    requireOrganizationIdentity(
      context.organizationId,
      context.organizationSlug,
      response.organizationId
    );
    emitSuccess(context, "projects.list", {
      ...response,
      localBindings: connections.map(({ status: _status, ...binding }) =>
        toPublicAgentActivityBinding(binding)
      ),
      ...(context.json ? {} : { localConnections: connections }),
    });
  });
}

export async function runAgentActivityRead(
  input: CommandInput & {
    member?: string;
    project?: string;
    provider?: string;
    status?: string;
  } = {}
): Promise<void> {
  await runProjectCommand(input, "activity.read", async (context) => {
    let projectId: string | undefined;
    if (input.project) {
      const snapshot = await context.activityApi.readSnapshot();
      requireOrganizationIdentity(
        context.organizationId,
        context.organizationSlug,
        snapshot.organizationId
      );
      projectId = resolveProjectId(snapshot.projects, input.project);
    }
    const query = agentActivitySnapshotQuerySchema.parse({
      ...(input.member === undefined ? {} : { memberUserId: input.member }),
      ...(projectId === undefined ? {} : { projectId }),
      ...(input.provider === undefined ? {} : { provider: input.provider }),
      ...(input.status === undefined
        ? {}
        : { status: agentActivitySessionStatusSchema.parse(input.status) }),
    });
    const response = await context.activityApi.readSnapshot(query);
    requireOrganizationIdentity(
      context.organizationId,
      context.organizationSlug,
      response.organizationId
    );
    emitSuccess(context, "activity.read", response);
  });
}

export async function runAgentActivitySessions(
  input: CommandInput & {
    cursor?: string;
    limit?: string;
    member?: string;
    nativeSession?: string;
    origin?: string;
    project?: string;
    provider?: string;
    query?: string;
    status?: string;
  } = {}
): Promise<void> {
  await runProjectCommand(input, "activity.sessions", async (context) => {
    let projectId: string | undefined;
    if (input.project) {
      const projects = await context.projectsApi.list();
      requireOrganizationIdentity(
        context.organizationId,
        context.organizationSlug,
        projects.organizationId
      );
      projectId = resolveProjectId(projects.projects, input.project);
    }
    const response = await context.activityApi.readSessions(
      agentActivitySessionInventoryQuerySchema.parse({
        ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
        ...(input.limit === undefined ? {} : { limit: input.limit }),
        ...(input.member === undefined ? {} : { memberUserId: input.member }),
        ...(input.nativeSession === undefined
          ? {}
          : { nativeSessionId: input.nativeSession }),
        ...(input.origin === undefined
          ? {}
          : {
              origin: agentActivityInventorySessionOriginSchema.parse(
                input.origin
              ),
            }),
        ...(projectId === undefined ? {} : { projectId }),
        ...(input.provider === undefined
          ? {}
          : {
              provider: localAgentSessionProviderSchema.parse(input.provider),
            }),
        ...(input.query === undefined ? {} : { query: input.query }),
        ...(input.status === undefined
          ? {}
          : {
              status: agentActivityInventorySessionStatusSchema.parse(
                input.status
              ),
            }),
      })
    );
    requireOrganizationIdentity(
      context.organizationId,
      context.organizationSlug,
      response.organization.id
    );
    emitSuccess(context, "activity.sessions", response);
  });
}

export async function runProjectsCreate(
  input: CommandInput & { name?: string; slug?: string }
): Promise<void> {
  await runProjectCommand(input, "create", async (context) => {
    const response = await context.projectsApi.create({
      expectedOrganizationId: context.organizationId,
      name: requireOption(input.name, "--name"),
      slug: requireOption(input.slug, "--slug"),
    });
    requireOrganizationIdentity(
      context.organizationId,
      context.organizationSlug,
      response.project.organizationId
    );
    emitSuccess(context, "projects.create", response);
  });
}

export async function runProjectsUpdate(
  input: CommandInput & { name?: string; projectId: string; slug?: string }
): Promise<void> {
  await runProjectCommand(input, "update", async (context) => {
    const response = await context.projectsApi.update({
      expectedOrganizationId: context.organizationId,
      projectId: requireOption(input.projectId, "project-id"),
      ...(input.name === undefined ? {} : { name: input.name }),
      ...(input.slug === undefined ? {} : { slug: input.slug }),
    });
    requireOrganizationIdentity(
      context.organizationId,
      context.organizationSlug,
      response.project.organizationId
    );
    emitSuccess(context, "projects.update", response);
  });
}

export async function runProjectsArchive(
  input: CommandInput & { projectId: string; yes?: boolean }
): Promise<void> {
  await runProjectCommand(input, "archive", async (context) => {
    if (input.yes !== true) {
      throw new Error("Pass --yes to confirm Project archive.");
    }
    await assertProjectBindingProducerCompatible();
    const projectId = requireOption(input.projectId, "project-id");
    const response = await context.projectsApi.archive({
      expectedOrganizationId: context.organizationId,
      projectId,
    });
    requireOrganizationIdentity(
      context.organizationId,
      context.organizationSlug,
      response.project.organizationId
    );
    const binding = (
      await listProjectBindings({
        organizationId: context.organizationId,
      })
    ).find((candidate) => candidate.projectId === projectId);
    if (binding) {
      await unbindAndPurgeLocalProject(binding, {
        producerCompatibilityChecked: true,
      });
    }
    emitSuccess(context, "projects.archive", response);
  });
}

async function unbindAndPurgeLocalProject(
  binding: {
    organizationId: string;
    projectId: string;
  },
  options: { producerCompatibilityChecked?: boolean } = {}
) {
  if (options.producerCompatibilityChecked !== true) {
    await assertProjectBindingProducerCompatible();
  }
  const removedProjectScopes = new Map<
    string,
    { organizationId: string; projectId: string }
  >();
  await unbindProject({
    afterRemove: (removed) => {
      removedProjectScopes.set(
        `${removed.organizationId}\0${removed.projectId}`,
        removed
      );
    },
    organizationId: binding.organizationId,
    projectId: binding.projectId,
  });
  for (const removed of removedProjectScopes.values()) {
    await purgeLocalProject(removed);
  }
  if ((await listProjectBindings({})).length === 0) {
    await unregisterAgentActivityRoute({
      rootDir: resolveOpenMeldRootDir(),
    }).catch((error: unknown) => {
      process.stderr.write(
        `[openmeld.agent_activity.route_unregister_failed] ${error instanceof Error ? error.message : String(error)}\n`
      );
    });
  }
}

export async function purgeLocalProject(binding: {
  organizationId: string;
  projectId: string;
}) {
  await Promise.all([
    removeProjectInbox({
      organizationId: binding.organizationId,
      projectId: binding.projectId,
    }),
    removeProjectOutbox({
      organizationId: binding.organizationId,
      projectId: binding.projectId,
    }),
    removeAgentActivityContextCache({
      organizationId: binding.organizationId,
      projectId: binding.projectId,
    }),
  ]);
}

export function toPublicAgentActivityBinding<
  T extends { bindingGeneration: string; isDefault?: boolean },
>(binding: T) {
  const {
    bindingGeneration: _bindingGeneration,
    isDefault: _isDefault,
    ...publicBinding
  } = binding;
  return publicBinding;
}

export async function runProjectsBind(
  input: CommandInput & {
    allowUnverified?: boolean;
    path?: string;
    projectSlug: string;
  }
): Promise<void> {
  await runProjectCommand(input, "bind", async (context) => {
    const projectSlug = requireOption(input.projectSlug, "project-slug");
    const projects = await context.projectsApi.list();
    requireOrganizationIdentity(
      context.organizationId,
      context.organizationSlug,
      projects.organizationId
    );
    const project = projects.projects.find(
      (candidate) => candidate.slug === projectSlug
    );
    if (!project || project.archivedAtMs !== null) {
      throw new Error(`Active Project "${projectSlug}" was not found.`);
    }
    const requestedPath = input.path ?? process.cwd();
    const connection = await validateLocalProjectConnectionPath({
      allowUnverifiedNonGit: input.allowUnverified === true,
      declaredPath: requestedPath,
      projectRepositoryFingerprint: project.repositoryFingerprint,
    }).catch((error: unknown) => {
      if (
        error instanceof LocalProjectConnectionError &&
        error.code === "confirmation_required"
      ) {
        throw new LocalProjectConnectionError(
          error.code,
          "OpenMeld couldn’t verify this folder with Git. To connect it without automatic matching or worktree discovery, retry this command with `--allow-unverified`."
        );
      }
      throw error;
    });
    await assertProjectBindingProducerCompatible();
    const binding = await bindProject({
      organizationId: context.organizationId,
      projectId: project.id,
      projectSlug: project.slug,
      repositoryFingerprint: connection.repositoryFingerprint,
      repositoryPath: connection.canonicalPath,
    });
    const integrationSetup = await activateAgentActivityIntegrations();
    emitSuccess(context, "projects.bind", {
      binding: toPublicAgentActivityBinding(binding),
      integrationSetup,
      project,
      ...(context.json || !connection.normalizedFrom
        ? {}
        : { normalizedFrom: connection.normalizedFrom }),
    });
  });
}

export async function activateAgentActivityIntegrations(input?: {
  homeDir?: string;
  install?: typeof installAgentActivityIntegrations;
  register?: typeof registerAgentActivityRoute;
  rootDir?: string;
}) {
  try {
    await (input?.register ?? registerAgentActivityRoute)({
      rootDir: input?.rootDir ?? resolveOpenMeldRootDir(),
    });
    return {
      integrations: await (input?.install ?? installAgentActivityIntegrations)({
        paths: defaultManagedIntegrationPaths(input?.homeDir ?? homedir()),
      }),
      status: "ready" as const,
    };
  } catch (error) {
    process.stderr.write(
      `[openmeld.agent_activity.integration_setup_failed] ${error instanceof Error ? error.name : "UnknownError"}\n`
    );
    return {
      message: `The Project is connected, but OpenMeld could not install every managed observer. Run \`${resolveAgentActivityDispatcherCommand() ?? "openmeld"} activity install\` from an installed OpenMeld CLI lane for details.`,
      status: "needs_attention" as const,
    };
  }
}

export async function runProjectsUnbind(
  input: CommandInput & {
    organizationId?: string;
    projectId?: string;
    projectSlug: string;
  }
): Promise<void> {
  const viewMode = parseCliViewMode(input.view);
  const runtime = {
    interactive: Boolean(process.stdin.isTTY && process.stdout.isTTY),
    resolvedView: viewMode === "agent" ? "agent" : "human",
    viewMode,
  } as const;
  const presenter = createPresenter(runtime);
  const json = input.json === true;
  const projectSlug = requireOption(input.projectSlug, "project-slug");
  try {
    const candidates = (await listProjectBindings({})).filter(
      (binding) =>
        binding.projectSlug === projectSlug &&
        (input.organizationId === undefined ||
          binding.organizationId === input.organizationId) &&
        (input.projectId === undefined || binding.projectId === input.projectId)
    );
    if (candidates.length === 0) {
      throw new Error(`Project "${projectSlug}" is not bound on this device.`);
    }
    const projectScopes = new Map<string, (typeof candidates)[number]>();
    for (const candidate of candidates) {
      projectScopes.set(
        `${candidate.organizationId}\0${candidate.projectId}`,
        candidate
      );
    }
    if (projectScopes.size > 1) {
      const organizations = new Set(
        candidates.map((candidate) => candidate.organizationId)
      );
      throw new Error(
        organizations.size > 1
          ? `Project "${projectSlug}" is bound in more than one Organization. Retry with --organization <organization-id>.`
          : `Project slug "${projectSlug}" matches more than one local Project. Retry with --project-id <project-id>.`
      );
    }
    const binding = projectScopes.values().next().value;
    if (!binding) {
      throw new Error(`Project "${projectSlug}" is not bound on this device.`);
    }
    await unbindAndPurgeLocalProject(binding);
    if (json) {
      emitCliJsonEnvelope(
        cliJsonOutputEnvelopeSchema.parse({
          organizationId: binding.organizationId,
          projectSlug,
          schemaVersion: 1,
          type: "projects.unbind",
          unbound: true,
        })
      );
      return;
    }
    renderInfoCard({
      codePrefix: "projects.unbind",
      presenter,
      rows: [
        { label: "Project", value: projectSlug },
        { label: "Collection", value: "Stopped on this device" },
      ],
      sanitize: true,
      title: "Project Unbound",
    });
  } catch (error) {
    process.exitCode = 1;
    const message = error instanceof Error ? error.message : String(error);
    if (json) {
      emitCliErrorJson({
        code: isProjectBindingUpdateRequiredError(error)
          ? "project_bindings.update_required"
          : "projects.unbind.failed",
        message,
      });
      return;
    }
    renderInfoCard({
      codePrefix: "projects.unbind.error",
      presenter,
      rows: [{ label: "Problem", value: message }],
      sanitize: true,
      title: "Project Unbind Failed",
    });
  }
}

export type ProjectCommandContext = {
  activityApi: ReturnType<typeof createAgentActivityApi>;
  json: boolean;
  organizationId: string;
  organizationName: string;
  organizationSlug: string;
  presenter: Presenter;
  projectsApi: ReturnType<typeof createProjectsApi>;
};

export async function runProjectCommand(
  input: CommandInput,
  operation: string,
  run: (context: ProjectCommandContext) => Promise<void>
): Promise<void> {
  const runtime = await resolveRuntimeContext({ view: input.view });
  const presenter = createPresenter(runtime);
  const json = input.json === true;
  let organizationSlug: string | null = null;
  try {
    const auth = await getAuthSessionState({ validateRemote: true });
    const organization = auth.session?.activeOrganization;
    if (auth.state !== "valid" || !organization) {
      throw new Error(
        "Sign in and choose an active Organization before managing Projects."
      );
    }
    organizationSlug = organization.slug;
    const apiClient = createCliApiClientFoundation(await resolveBaseUrl());
    await run({
      activityApi: createAgentActivityApi(apiClient),
      json,
      organizationId: organization.id,
      organizationName: organization.name,
      organizationSlug: organization.slug,
      presenter,
      projectsApi: createProjectsApi(apiClient),
    });
  } catch (error) {
    process.exitCode = 1;
    const rawMessage = error instanceof Error ? error.message : String(error);
    const message = resolveProjectCommandErrorMessage(
      rawMessage,
      organizationSlug
    );
    const code = resolveProjectCommandErrorCode(error, operation);
    if (json) {
      emitCliErrorJson({
        code: isProjectBindingUpdateRequiredError(error)
          ? code
          : `${code}.failed`,
        message,
      });
      return;
    }
    renderInfoCard({
      codePrefix: `${code}.error`,
      presenter,
      rows: [
        { label: "Problem", value: message },
        {
          label: "Next",
          value: operation.startsWith("activity.")
            ? "Run `openmeld activity --view agent` for explicit diagnostics."
            : "Run `openmeld projects list` and retry.",
        },
      ],
      sanitize: true,
      title: operation.startsWith("activity.")
        ? "Agent Activity Failed"
        : "Project Command Failed",
    });
  }
}

function resolveProjectCommandErrorCode(
  error: unknown,
  operation: string
): string {
  if (isProjectBindingUpdateRequiredError(error)) {
    return "project_bindings.update_required";
  }
  if (operation.startsWith("activity.")) {
    return operation;
  }
  return `projects.${operation}`;
}

export function emitSuccess(
  context: ProjectCommandContext,
  code: string,
  payload: Record<string, unknown>
): void {
  if (context.json) {
    emitCliJsonEnvelope(
      cliJsonOutputEnvelopeSchema.parse({
        schemaVersion: 1,
        type: code,
        ...payload,
      })
    );
    return;
  }
  if (emitActivitySuccess(context, code, payload)) {
    return;
  }
  const nowMs = Date.now();
  const project = "project" in payload ? (payload.project as Project) : null;
  const projectCount =
    "projects" in payload && Array.isArray(payload.projects)
      ? payload.projects.length
      : null;
  const integrationSetup =
    "integrationSetup" in payload &&
    payload.integrationSetup &&
    typeof payload.integrationSetup === "object" &&
    "status" in payload.integrationSetup
      ? payload.integrationSetup
      : null;
  renderInfoCard({
    codePrefix: code,
    presenter: context.presenter,
    rows: [
      { label: "Organization", value: context.organizationName },
      ...buildProjectRows(payload, project),
      ...(projectCount === null
        ? []
        : [{ label: "Projects", value: String(projectCount) }]),
      ...buildLocalConnectionRows(payload),
      ...(integrationSetup
        ? [
            {
              label: "Observers",
              value:
                integrationSetup.status === "ready"
                  ? "Managed Codex, Claude Code, Cursor, and OpenCode observers are ready."
                  : "Needs attention. Run `openmeld activity install` for details.",
            },
          ]
        : []),
      ...("sessions" in payload && Array.isArray(payload.sessions)
        ? [
            {
              label: "Active now",
              value: String(
                payload.sessions.filter((session) =>
                  isAgentActivitySessionActiveAt(session, nowMs)
                ).length
              ),
            },
            { label: "Sessions", value: String(payload.sessions.length) },
          ]
        : []),
      ...("recentEvents" in payload && Array.isArray(payload.recentEvents)
        ? [
            {
              label: "Recent events",
              value: String(payload.recentEvents.length),
            },
          ]
        : []),
      ...("binding" in payload
        ? [
            {
              label: "Local path",
              value: String(
                (payload.binding as { repositoryPath: string }).repositoryPath
              ),
            },
          ]
        : []),
      ...buildPathResolutionRows(payload),
      ...("unbound" in payload
        ? [{ label: "Collection", value: "Stopped on this device" }]
        : []),
    ],
    sanitize: true,
    title: titleForCode(code),
  });
}

function emitActivitySuccess(
  context: ProjectCommandContext,
  code: string,
  payload: Record<string, unknown>
): boolean {
  if (code === "activity.read" && context.presenter.view === "agent") {
    emitAgentActivitySnapshot(
      context.presenter,
      payload as AgentActivitySnapshotResponse
    );
    return true;
  }
  if (code === "activity.sessions" && context.presenter.view === "agent") {
    emitAgentActivitySessionInventory(
      context.presenter,
      payload as AgentActivitySessionInventoryResponse
    );
    return true;
  }
  if (code === "activity.sessions") {
    emitHumanAgentActivitySessionInventory({
      inventory: payload as AgentActivitySessionInventoryResponse,
      presenter: context.presenter,
    });
    return true;
  }
  if (code === "activity.read") {
    emitHumanAgentActivitySnapshot({
      organizationName: context.organizationName,
      presenter: context.presenter,
      snapshot: payload as AgentActivitySnapshotResponse,
    });
    return true;
  }
  return false;
}

function buildLocalConnectionRows(payload: Record<string, unknown>) {
  const values = readLocalConnectionValues(payload);
  if (!values) {
    return [];
  }
  return values.map((value) => {
    const connection = value as {
      bindingGeneration?: string;
      isDefault: boolean;
      path?: string;
      projectSlug?: string;
      repositoryPath?: string;
      status: "available" | "missing";
    };
    const projectSlug = connection.projectSlug ?? String(payload.projectSlug);
    const path = connection.repositoryPath ?? connection.path ?? "Unknown";
    return {
      label: connection.isDefault ? `${projectSlug} · Default` : projectSlug,
      value: `${path} · ${connection.status === "available" ? "Available" : "Missing"}${connection.bindingGeneration ? ` · Generation ${connection.bindingGeneration}` : ""}`,
    };
  });
}

function buildProjectRows(
  payload: Record<string, unknown>,
  project: Project | null
) {
  if (project) {
    return [{ label: "Project", value: `${project.name} (${project.slug})` }];
  }
  return "projectSlug" in payload
    ? [{ label: "Project", value: String(payload.projectSlug) }]
    : [];
}

function readLocalConnectionValues(
  payload: Record<string, unknown>
): unknown[] | null {
  if (
    "localConnections" in payload &&
    Array.isArray(payload.localConnections)
  ) {
    return payload.localConnections;
  }
  if ("connections" in payload && Array.isArray(payload.connections)) {
    return payload.connections;
  }
  return null;
}

function buildPathResolutionRows(payload: Record<string, unknown>) {
  if (!("normalizedFrom" in payload)) {
    return [];
  }
  return [
    {
      label: "Resolved from",
      value: `${String(payload.normalizedFrom)} → repository root`,
    },
  ];
}

export function resolveProjectId(
  projects: readonly Project[],
  projectSlug: string
) {
  const project = projects.find((candidate) => candidate.slug === projectSlug);
  if (!project) {
    throw new Error(
      `Project "${projectSlug}" was not found in this Organization.`
    );
  }
  return project.id;
}

export function emitAgentActivitySnapshot(
  presenter: Presenter,
  snapshot: AgentActivitySnapshotResponse
) {
  presenter.data({
    code: "activity.snapshot",
    payload: {
      asOfMs: snapshot.asOfMs,
      digestsTruncated: snapshot.digestsTruncated,
      organizationId: snapshot.organizationId,
      sessionsTruncated: snapshot.sessionsTruncated,
      stalenessThresholdMs: snapshot.stalenessThresholdMs,
    },
  });
  for (const project of snapshot.projects) {
    presenter.data({ code: "activity.project", payload: project });
  }
  for (const session of snapshot.sessions) {
    presenter.data({ code: "activity.session", payload: session });
  }
  for (const digest of snapshot.digests) {
    presenter.data({ code: "activity.digest", payload: digest });
  }
  for (const event of snapshot.recentEvents) {
    presenter.data({ code: "activity.event", payload: event });
  }
}

export function emitAgentActivitySessionInventory(
  presenter: Presenter,
  inventory: AgentActivitySessionInventoryResponse
) {
  presenter.data({
    code: "activity.sessions.inventory",
    payload: {
      asOfMs: inventory.asOfMs,
      nextCursor: inventory.nextCursor,
      organization: inventory.organization,
      sessionCount: inventory.sessions.length,
    },
  });
  for (const coverage of inventory.coverage) {
    presenter.data({ code: "activity.sessions.coverage", payload: coverage });
  }
  for (const session of inventory.sessions) {
    presenter.data({ code: "activity.sessions.session", payload: session });
  }
}

export function emitHumanAgentActivitySessionInventory(input: {
  inventory: AgentActivitySessionInventoryResponse;
  presenter: Presenter;
}) {
  const { inventory } = input;
  const coverageProblems = inventory.coverage.filter(
    (coverage) => coverage.state !== "current"
  );
  renderInfoCard({
    codePrefix: "activity.sessions",
    presenter: input.presenter,
    rows: [
      { label: "Organization", value: inventory.organization.name },
      { label: "As of", value: new Date(inventory.asOfMs).toISOString() },
      {
        label: "Sessions on this page",
        value: String(inventory.sessions.length),
      },
      ...coverageProblems.map((coverage) => ({
        label: `${providerDisplayName(coverage.provider)} coverage`,
        value: `${coverage.state}${coverage.problemCode ? ` · ${coverage.problemCode}` : ""}`,
      })),
      ...inventory.sessions.map((session) => ({
        label: session.nativeSessionTitle ?? session.nativeSessionId,
        value: [
          session.owner.name,
          session.project.name,
          session.computer.name,
          session.localAgent.name,
          session.status,
          session.dataState,
          new Date(session.lastActiveAtMs).toISOString(),
          `ID ${session.nativeSessionId}`,
          session.boundAgentProfileId
            ? `Agent Profile ${session.boundAgentProfileId}`
            : "Not connected to an Agent Profile",
        ].join(" · "),
      })),
      ...(inventory.nextCursor
        ? [
            {
              label: "Next page",
              value: `Run again with --cursor ${inventory.nextCursor}`,
            },
          ]
        : []),
    ],
    sanitize: true,
    title: "Agent Activity Sessions",
  });
}

export function emitHumanAgentActivitySnapshot(input: {
  nowMs?: number;
  organizationName: string;
  presenter: Presenter;
  snapshot: AgentActivitySnapshotResponse;
}) {
  const nowMs = input.nowMs ?? Date.now();
  const { snapshot } = input;
  const projects = new Map(
    snapshot.projects.map((project) => [project.id, project.name])
  );
  const visibleSessions = snapshot.sessions.slice(0, 12);
  renderInfoCard({
    codePrefix: "activity.read",
    presenter: input.presenter,
    rows: [
      { label: "Organization", value: input.organizationName },
      { label: "As of", value: new Date(snapshot.asOfMs).toISOString() },
      {
        label: "Freshness",
        value: `Presence expires after ${Math.round(snapshot.stalenessThresholdMs / 60_000)} minutes without evidence.`,
      },
      {
        label: "Active now",
        value: String(
          snapshot.sessions.filter((session) =>
            isAgentActivitySessionActiveAt(session, nowMs)
          ).length
        ),
      },
      ...visibleSessions.map((session) => ({
        label: `${projects.get(session.projectId) ?? "Unknown Project"} · ${session.memberName}`,
        value: `${providerLabel(session.provider)} · ${session.status} · ${new Date(session.lastObservedAtMs).toISOString()}`,
      })),
      ...(snapshot.sessionsTruncated
        ? [
            {
              label: "Sessions",
              value:
                "More sessions exist. Narrow the Project or member filter.",
            },
          ]
        : []),
      ...(snapshot.digestsTruncated
        ? [
            {
              label: "Digests",
              value: "More digests exist. Narrow the Project filter.",
            },
          ]
        : []),
    ],
    sanitize: true,
    title: "Agent Activity",
  });
}

function isAgentActivitySessionActiveAt(session: unknown, nowMs: number) {
  return Boolean(
    session &&
      typeof session === "object" &&
      "isActive" in session &&
      session.isActive === true &&
      "expiresAtMs" in session &&
      typeof session.expiresAtMs === "number" &&
      session.expiresAtMs > nowMs
  );
}

function providerLabel(provider: AgentActivityProvider) {
  if (provider === "claude-code") {
    return "Claude Code";
  }
  if (provider === "cursor") {
    return "Cursor";
  }
  return provider === "opencode" ? "OpenCode" : "Codex";
}

function providerDisplayName(
  provider: AgentActivitySessionInventoryResponse["coverage"][number]["provider"]
) {
  return {
    "claude-code": "Claude Code",
    codex: "Codex",
    cursor: "Cursor",
    "grok-build": "Grok Build",
    opencode: "OpenCode",
  }[provider];
}

export function requireOption(
  value: string | undefined,
  label: string
): string {
  const normalized = value?.trim();
  if (!normalized) {
    throw new Error(`${label} is required.`);
  }
  return normalized;
}

export function requireOrganizationIdentity(
  expectedOrganizationId: string,
  expectedOrganizationSlug: string,
  responseOrganizationId: string
): void {
  if (expectedOrganizationId !== responseOrganizationId) {
    throw new Error(
      `The active Organization changed before this Project command completed. Run \`openmeld org switch ${expectedOrganizationSlug}\`, then retry.`
    );
  }
}

function resolveProjectCommandErrorMessage(
  message: string,
  organizationSlug: string | null
): string {
  if (
    organizationSlug &&
    message.includes("agent_activity.organization_context_changed")
  ) {
    return `The active Organization changed before this Project command completed. Run \`openmeld org switch ${organizationSlug}\`, then retry.`;
  }
  return message;
}

function titleForCode(code: string): string {
  if (code === "activity.read" || code === "activity.sessions") {
    return "Agent Activity";
  }
  const action = (code.split(".").at(-1) ?? "complete").replaceAll("_", " ");
  return `Project ${action.charAt(0).toUpperCase()}${action.slice(1)}`;
}
