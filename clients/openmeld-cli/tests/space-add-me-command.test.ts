import { execFile } from "node:child_process";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const execFileAsync = promisify(execFile);

const {
  createOpenMeldAgentProfileMock,
  ensureAgentProfileRuntimeBindingMock,
  listOpenMeldProfilesMock,
  prepareAuthenticatedSpaceCommandContextMock,
  readProfileWorkspaceConfigMock,
  resolveAgentProfilePrimaryAgentControllerReportMock,
  resolveAgentControllerPermissionModeInputMock,
  resolveOpenMeldProfileForSpaceCommandMock,
  runSpaceAddMembersMock,
  setCustomProfileWorkspaceMock,
  submitRuntimeAgentControllerReportMock,
  updateAgentProfilePrimaryBindingAgentControllerPermissionModeMock,
  validateCustomProfileWorkspacePathMock,
} = vi.hoisted(() => ({
  createOpenMeldAgentProfileMock: vi.fn(),
  ensureAgentProfileRuntimeBindingMock: vi.fn(),
  listOpenMeldProfilesMock: vi.fn(),
  prepareAuthenticatedSpaceCommandContextMock: vi.fn(),
  readProfileWorkspaceConfigMock: vi.fn(),
  resolveAgentProfilePrimaryAgentControllerReportMock: vi.fn(),
  resolveAgentControllerPermissionModeInputMock: vi.fn(),
  resolveOpenMeldProfileForSpaceCommandMock: vi.fn(),
  runSpaceAddMembersMock: vi.fn(),
  setCustomProfileWorkspaceMock: vi.fn(),
  submitRuntimeAgentControllerReportMock: vi.fn(),
  updateAgentProfilePrimaryBindingAgentControllerPermissionModeMock: vi.fn(),
  validateCustomProfileWorkspacePathMock: vi.fn(),
}));

vi.mock("../src/config/openmeld-profiles-api", () => ({
  createOpenMeldAgentProfile: createOpenMeldAgentProfileMock,
  listOpenMeldProfiles: listOpenMeldProfilesMock,
}));

vi.mock("../src/auth/command-auth", () => ({
  buildCommandAuthenticationPromptMessage: (action: string) =>
    `Authenticate before ${action}.`,
}));

vi.mock("../src/space/command-context", () => ({
  assertValidSpaceIdTarget: vi.fn(),
  prepareAuthenticatedSpaceCommandContext:
    prepareAuthenticatedSpaceCommandContextMock,
  resolveOpenMeldProfileForSpaceCommand:
    resolveOpenMeldProfileForSpaceCommandMock,
}));

vi.mock("../src/profile/controller-permission-mode-input", () => ({
  resolveAgentControllerPermissionModeInput:
    resolveAgentControllerPermissionModeInputMock,
}));

vi.mock("../src/profile-workspace/custom-path", () => ({
  describeProfileWorkspacePathValidationFailure: (input: {
    path: string;
    reason: string;
  }) => `Workspace path '${input.path}' is invalid (${input.reason}).`,
}));

vi.mock("../src/profile-workspace/service", () => ({
  normalizeCustomProfileWorkspacePath: (value: string) => {
    if (!isAbsolute(value)) {
      throw new Error(`Workspace path '${value}' must be absolute.`);
    }
    return resolve(value);
  },
  readProfileWorkspaceConfig: readProfileWorkspaceConfigMock,
  resolveConfiguredProfileWorkspacePath: (input: {
    value: { customWorkspacePath?: string; mode: string };
  }) => {
    if (input.value.mode === "custom" && input.value.customWorkspacePath) {
      return resolve(input.value.customWorkspacePath);
    }
    return "/tmp/openmeld-managed-profile-workspace";
  },
  setCustomProfileWorkspace: setCustomProfileWorkspaceMock,
  validateCustomProfileWorkspacePath: validateCustomProfileWorkspacePathMock,
}));

vi.mock("../src/system/agent-profile-primary-binding", () => ({
  resolveAgentProfilePrimaryAgentControllerReport:
    resolveAgentProfilePrimaryAgentControllerReportMock,
}));

vi.mock(
  "../src/local-service/reporting/runtime-agent-controller-reporting-submission",
  () => ({
    submitRuntimeAgentControllerReport: submitRuntimeAgentControllerReportMock,
  })
);

vi.mock("../src/system/ensure-agent-profile-runtime-binding", () => ({
  ensureAgentProfileRuntimeBinding: ensureAgentProfileRuntimeBindingMock,
}));

vi.mock(
  "../src/system/agent-profile-binding-agent-controller-permission-mode",
  () => ({
    updateAgentProfilePrimaryBindingAgentControllerPermissionMode:
      updateAgentProfilePrimaryBindingAgentControllerPermissionModeMock,
  })
);

const SPACE_ID = "a".repeat(64);
const HUMAN_PROFILE = {
  openMeldProfileId: "hum_current",
  profileName: "Felix",
  profileHandle: "felix",
  profileKind: "human",
  status: "active",
  ownerUserId: "user-1",
  source: "test",
  createdByUserId: "user-1",
  lastUsedAt: null,
  createdAt: "2026-06-01T00:00:00.000Z",
  updatedAt: "2026-06-01T00:00:00.000Z",
};
const CREATED_AGENT_PROFILE = {
  ...HUMAN_PROFILE,
  openMeldProfileId: "agt_current",
  profileName: "Codex - project",
  profileHandle: "codex-project",
  profileKind: "agent",
};
const CONFLICTING_PROJECT_FOLDER_OPTIONS_RE =
  /Conflicting Project folder options: .*--project-folder.*--cwd/s;
const PROJECT_FOLDER_MISMATCH_RE = /already bound to Project folder/;
const AGENT_ACTING_IDENTITY_RE =
  /selected profile must be a Human Profile because OpenMeld uses it as the signed-in user's acting identity/;
const CODEX_MISSING_THREAD_RE = /cannot find CODEX_THREAD_ID/;
const BINDING_READ_TIMEOUT_RE = /could not read Agent Profile Bindings/;

describe("space add-me command", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    prepareAuthenticatedSpaceCommandContextMock.mockResolvedValue({
      status: "ready",
      runtime: { resolvedView: "agent", interactive: false },
      interactive: false,
      presenter: createPresenterCapture(),
      baseUrl: "https://gateway.openmeld.ai",
      authenticatedGatewayUrl: "https://gateway.openmeld.ai",
    });
    resolveOpenMeldProfileForSpaceCommandMock.mockResolvedValue(HUMAN_PROFILE);
    runSpaceAddMembersMock.mockResolvedValue("completed");
    listOpenMeldProfilesMock.mockResolvedValue([]);
    createOpenMeldAgentProfileMock.mockResolvedValue(CREATED_AGENT_PROFILE);
    readProfileWorkspaceConfigMock.mockResolvedValue({ status: "missing" });
    setCustomProfileWorkspaceMock.mockResolvedValue({});
    validateCustomProfileWorkspacePathMock.mockImplementation(
      async (path: string) => ({ status: "valid", value: path })
    );
    resolveAgentControllerPermissionModeInputMock.mockResolvedValue({
      hasAnyAgentControllerPermissionModeInput: false,
    });
    submitRuntimeAgentControllerReportMock.mockResolvedValue({
      agentControllerRef: "builtin:codex",
      agentControllerReportStatus: "accepted",
      deviceId: "device-1",
      lane: "dev",
      openMeldServiceRuntimeId: "runtime-1",
      reasonCodes: [],
      source: "runtime_reporting_api",
      status: "submitted",
    });
    ensureAgentProfileRuntimeBindingMock.mockResolvedValue({
      outcome: "created",
      reasonCodes: [],
      routable: true,
      source: "agent_profile_binding_api",
      status: "accepted",
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("parses an org-scoped Space URL with profileId", async () => {
    const { parseSpaceAddMeTarget } = await import(
      "../src/space/add-me-command"
    );

    expect(
      parseSpaceAddMeTarget(
        `https://openmeld.ai/o/acme/spaces/${SPACE_ID}?profileId=hum_url`
      )
    ).toEqual({
      baseUrl: "https://gateway.openmeld.ai",
      profileId: "hum_url",
      spaceId: SPACE_ID,
    });
  });

  it("keeps accepting legacy /app Space URLs for copied add-me inputs", async () => {
    const { parseSpaceAddMeTarget } = await import(
      "../src/space/add-me-command"
    );

    expect(
      parseSpaceAddMeTarget(
        `https://openmeld.ai/app/spaces/${SPACE_ID}?profileId=hum_url`
      )
    ).toEqual({
      baseUrl: "https://gateway.openmeld.ai",
      profileId: "hum_url",
      spaceId: SPACE_ID,
    });
  });

  it("fails closed when Space URL profileId conflicts with --profile before auth or membership writes", async () => {
    const { runSpaceAddMe } = await import("../src/space/add-me-command");

    await expect(
      runSpaceAddMe({
        addMembers: runSpaceAddMembersMock,
        env: {},
        profile: "hum_cli",
        space: `https://openmeld.ai/o/acme/spaces/${SPACE_ID}?profileId=hum_url`,
      })
    ).rejects.toThrow(
      "Space URL profileId (hum_url) conflicts with --profile (hum_cli). Pass one Human Profile acting identity."
    );
    expect(prepareAuthenticatedSpaceCommandContextMock).not.toHaveBeenCalled();
    expect(runSpaceAddMembersMock).not.toHaveBeenCalled();
  });

  it("detects Claude Code, Codex, and Codex without a thread honestly", async () => {
    const { detectSpaceAddMeSubject } = await import(
      "../src/space/add-me-command"
    );

    expect(
      detectSpaceAddMeSubject({ CLAUDE_CODE_SESSION_ID: "claude-session" })
    ).toEqual({
      kind: "agent",
      agentControllerConversationId: "claude-session",
      agentControllerRef: "builtin:claude-code",
      conversationKind: "session",
      label: "Claude Code",
    });
    expect(
      detectSpaceAddMeSubject({ CODEX_THREAD_ID: "codex-thread" })
    ).toEqual({
      kind: "agent",
      agentControllerConversationId: "codex-thread",
      agentControllerRef: "builtin:codex",
      conversationKind: "thread",
      label: "Codex",
    });
    expect(detectSpaceAddMeSubject({ CODEX_SHELL: "1" })).toEqual({
      kind: "codex_missing_thread",
    });
  });

  it("documents the typical agent-facing Space URL add-me flow", async () => {
    const [commandsGuide, spaceOpsPlaybook] = await Promise.all([
      readFile(
        new URL(
          "../skills/openmeld-cli/references/commands.md",
          import.meta.url
        ),
        "utf8"
      ),
      readFile(
        new URL(
          "../skills/openmeld-cli/playbooks/space-ops.md",
          import.meta.url
        ),
        "utf8"
      ),
    ]);

    for (const content of [commandsGuide, spaceOpsPlaybook]) {
      const normalized = content.replace(/\s+/g, " ").toLowerCase();
      expect(normalized).toContain("openmeld space add-me <space-url-or-id>");
      expect(normalized).toContain("--project-folder");
      expect(normalized).toContain("add yourself");
      expect(normalized).toContain("current project folder");
      expect(normalized).toContain("codex_thread_id");
      expect(normalized).toContain("--agent-controller builtin:codex");
      expect(normalized).toContain("claude_code_session_id");
      expect(normalized).toContain("claude code resume is scoped");
      expect(normalized).toContain("--agent-controller builtin:claude-code");
    }
  });

  it("prints add-me Project folder aliases without internal array defaults", async () => {
    const openMeldHome = await mkdtemp(
      join(tmpdir(), "openmeld-add-me-help-home-")
    );
    const cliRoot = fileURLToPath(new URL("..", import.meta.url));
    const env = {
      ...process.env,
      OPENMELD_HOME: openMeldHome,
    };
    await execFileAsync("corepack", ["pnpm", "run", "build"], {
      cwd: cliRoot,
      env,
    });
    const { stdout } = await execFileAsync(
      process.execPath,
      ["dist/openmeld.js", "space", "add-me", "--help"],
      { cwd: cliRoot, env }
    );

    expect(stdout).toContain("--project-folder <path>");
    expect(stdout).toContain("--workspace-path <path>");
    expect(stdout).toContain("--working-directory <path>");
    expect(stdout).toContain("--cwd <path>");
    expect(stdout).toContain(
      "Cursor: default|plan|ask|auto-review|run-everything."
    );
    expect(stdout).toContain(
      "Grok Build: default|accept-edits|plan|auto|dont-ask|bypass-permissions."
    );
    expect(stdout).not.toContain("(default: [])");
  });

  it("normalizes Project folder aliases and fails closed on conflicts", async () => {
    const { normalizeSpaceAddMeProjectFolderInput } = await import(
      "../src/space/add-me-command"
    );
    const cwd = await mkdtemp(join(tmpdir(), "openmeld-add-me-cwd-"));
    const same = normalizeSpaceAddMeProjectFolderInput(
      {
        projectFolder: [cwd],
        workspacePath: ["."],
        workingDirectory: [cwd],
        cwd: ["."],
      },
      cwd
    );

    expect(same.path).toBe(cwd);
    expect(() =>
      normalizeSpaceAddMeProjectFolderInput(
        {
          projectFolder: [cwd],
          cwd: [tmpdir()],
        },
        cwd
      )
    ).toThrow(CONFLICTING_PROJECT_FOLDER_OPTIONS_RE);
  });

  it("fails closed when the same conversation already has a different Project folder", async () => {
    const { runSpaceAddMe } = await import("../src/space/add-me-command");
    const oldProject = await mkdtemp(join(tmpdir(), "openmeld-add-me-old-"));
    const newProject = await mkdtemp(join(tmpdir(), "openmeld-add-me-new-"));
    const existingAgentProfile = {
      ...CREATED_AGENT_PROFILE,
      openMeldProfileId: "agt_existing",
    };
    listOpenMeldProfilesMock.mockResolvedValue([existingAgentProfile]);
    resolveAgentProfilePrimaryAgentControllerReportMock.mockResolvedValue({
      agentControllerRef: "builtin:claude-code",
      bindingState: "bound",
      primaryBinding: {
        executionTarget: {
          agentControllerConversationId: "claude-session",
        },
      },
      reasonCodes: [],
      routable: true,
    });
    readProfileWorkspaceConfigMock.mockResolvedValue({
      status: "valid",
      updatedAt: "2026-06-01T00:00:00.000Z",
      path: "/tmp/profile-meta.json",
      persistedVersion: 2,
      value: { mode: "custom", customWorkspacePath: oldProject },
    });

    await expect(
      runSpaceAddMe({
        addMembers: runSpaceAddMembersMock,
        env: { CLAUDE_CODE_SESSION_ID: "claude-session" },
        space: SPACE_ID,
        workingDirectory: newProject,
      })
    ).rejects.toThrow(PROJECT_FOLDER_MISMATCH_RE);
    expect(runSpaceAddMembersMock).not.toHaveBeenCalled();
  });

  it("routes Human add-me to self membership and a human-friendly next action", async () => {
    const { runSpaceAddMe } = await import("../src/space/add-me-command");
    const presenter = createPresenterCapture();
    prepareAuthenticatedSpaceCommandContextMock.mockResolvedValueOnce({
      status: "ready",
      runtime: { resolvedView: "human", interactive: false },
      interactive: false,
      presenter,
      baseUrl: "https://gateway.openmeld.ai",
      authenticatedGatewayUrl: "https://gateway.openmeld.ai",
    });

    await runSpaceAddMe({
      addMembers: runSpaceAddMembersMock,
      env: {},
      space: SPACE_ID,
    });

    expect(runSpaceAddMembersMock).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: "human_profiles",
        profile: HUMAN_PROFILE.openMeldProfileId,
        members: [HUMAN_PROFILE.openMeldProfileId],
        allowCurrentProfileMember: true,
        suppressResultOutput: true,
      })
    );
    const line = presenter.lines.find((entry) => entry.code === "space.add_me");
    expect(line?.text).toContain(`openmeld space join ${SPACE_ID}`);
    expect(line?.text).not.toContain("--view agent");
    expect(line?.text).not.toContain("Added");
  });

  it("keeps repeated/idempotent add-me output from claiming a new add", async () => {
    const { runSpaceAddMe } = await import("../src/space/add-me-command");
    const presenter = createPresenterCapture();
    prepareAuthenticatedSpaceCommandContextMock.mockResolvedValueOnce({
      status: "ready",
      runtime: { resolvedView: "human", interactive: false },
      interactive: false,
      presenter,
      baseUrl: "https://gateway.openmeld.ai",
      authenticatedGatewayUrl: "https://gateway.openmeld.ai",
    });

    await runSpaceAddMe({
      addMembers: runSpaceAddMembersMock,
      env: {},
      space: SPACE_ID,
    });

    const line = presenter.lines.find((entry) => entry.code === "space.add_me");
    expect(line?.text).toContain("Confirmed your Space membership path");
    expect(line?.text).not.toContain("Added");
    expect(line?.data?.proves).toBe(
      "OpenMeld completed the normal Space membership path for this profile."
    );
  });

  it("routes agent add-me through add-members and does not claim Wake readiness", async () => {
    const { runSpaceAddMe } = await import("../src/space/add-me-command");
    const project = await mkdtemp(join(tmpdir(), "openmeld-add-me-project-"));
    const presenter = createPresenterCapture();
    prepareAuthenticatedSpaceCommandContextMock.mockResolvedValueOnce({
      status: "ready",
      runtime: { resolvedView: "agent", interactive: false },
      interactive: false,
      presenter,
      baseUrl: "https://gateway.openmeld.ai",
      authenticatedGatewayUrl: "https://gateway.openmeld.ai",
    });

    await runSpaceAddMe({
      addMembers: runSpaceAddMembersMock,
      env: { CODEX_THREAD_ID: "codex-thread" },
      projectFolders: { projectFolder: [project] },
      space: SPACE_ID,
      workingDirectory: project,
    });

    expect(createOpenMeldAgentProfileMock).toHaveBeenCalled();
    expect(setCustomProfileWorkspaceMock).toHaveBeenCalledWith({
      openMeldProfileId: CREATED_AGENT_PROFILE.openMeldProfileId,
      customWorkspacePath: project,
    });
    expect(ensureAgentProfileRuntimeBindingMock).toHaveBeenCalledWith(
      expect.objectContaining({
        agentControllerConversationId: "codex-thread",
        profile: CREATED_AGENT_PROFILE,
      })
    );
    expect(runSpaceAddMembersMock).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: "agents",
        members: [CREATED_AGENT_PROFILE.openMeldProfileId],
        suppressResultOutput: true,
      })
    );
    const line = presenter.lines.find((entry) => entry.code === "space.add_me");
    expect(line?.data?.wakeReadiness).toBe("not_checked");
    expect(line?.data?.doesNotProve).toContain("Wake availability");
    expect(line?.data?.doesNotProve).not.toContain("Ready for Wake");
  });

  it("emits sparse progress while preparing a slow current Agent Profile", async () => {
    const { runSpaceAddMe } = await import("../src/space/add-me-command");
    const project = await mkdtemp(join(tmpdir(), "openmeld-add-me-project-"));
    const presenter = createPresenterCapture();
    const profiles = createDeferred<(typeof CREATED_AGENT_PROFILE)[]>();
    listOpenMeldProfilesMock.mockReturnValueOnce(profiles.promise);
    prepareAuthenticatedSpaceCommandContextMock.mockResolvedValueOnce({
      status: "ready",
      runtime: { resolvedView: "agent", interactive: false },
      interactive: false,
      presenter,
      baseUrl: "https://gateway.openmeld.ai",
      authenticatedGatewayUrl: "https://gateway.openmeld.ai",
    });
    vi.useFakeTimers();

    const command = runSpaceAddMe({
      addMembers: runSpaceAddMembersMock,
      env: { CODEX_THREAD_ID: "codex-thread" },
      projectFolders: { projectFolder: [project] },
      space: SPACE_ID,
      workingDirectory: project,
    });
    await flushPromises();

    expect(presenter.lines).not.toContainEqual(
      expect.objectContaining({ code: "space.add_me.progress" })
    );
    await vi.advanceTimersByTimeAsync(5000);
    expect(presenter.lines).toContainEqual(
      expect.objectContaining({
        code: "space.add_me.progress",
        data: { phase: "prepare_agent_profile", spaceId: SPACE_ID },
      })
    );

    profiles.resolve([]);
    await command;
  });

  it("explains Agent Profile Binding read timeouts before any Space membership write", async () => {
    const { runSpaceAddMe } = await import("../src/space/add-me-command");
    const project = await mkdtemp(join(tmpdir(), "openmeld-add-me-project-"));
    const existingAgentProfile = {
      ...CREATED_AGENT_PROFILE,
      openMeldProfileId: "agt_existing",
    };
    const timeout = Object.assign(
      new Error(
        "agent_profile_binding.primary.read request timed out after 10000ms"
      ),
      { code: "network.timeout" }
    );
    listOpenMeldProfilesMock.mockResolvedValue([existingAgentProfile]);
    resolveAgentProfilePrimaryAgentControllerReportMock.mockRejectedValue(
      timeout
    );

    let thrownError: Error | null = null;
    try {
      await runSpaceAddMe({
        addMembers: runSpaceAddMembersMock,
        env: { CODEX_THREAD_ID: "codex-thread" },
        projectFolders: { projectFolder: [project] },
        space: SPACE_ID,
        workingDirectory: project,
      });
    } catch (error) {
      thrownError = error as Error;
    }

    expect(thrownError?.message).toMatch(BINDING_READ_TIMEOUT_RE);
    expect(thrownError?.message).toContain(
      "No Space membership was written before this step completed."
    );
    expect(thrownError?.message).toContain("openmeld service status");
    expect(thrownError?.message).toContain(
      `openmeld space add-me ${SPACE_ID} --project-folder ${project}`
    );
    expect(thrownError?.message).toContain(timeout.message);
    expect(
      resolveAgentProfilePrimaryAgentControllerReportMock
    ).toHaveBeenCalledWith(
      expect.objectContaining({ bindingReads: expect.any(Object) })
    );
    expect(createOpenMeldAgentProfileMock).not.toHaveBeenCalled();
    expect(ensureAgentProfileRuntimeBindingMock).not.toHaveBeenCalled();
    expect(runSpaceAddMembersMock).not.toHaveBeenCalled();
  });

  it("rejects an Agent Profile acting identity before creating or adding the current agent", async () => {
    const { runSpaceAddMe } = await import("../src/space/add-me-command");
    const project = await mkdtemp(join(tmpdir(), "openmeld-add-me-project-"));
    resolveOpenMeldProfileForSpaceCommandMock.mockResolvedValueOnce({
      ...CREATED_AGENT_PROFILE,
      openMeldProfileId: "agt_actor",
    });

    await expect(
      runSpaceAddMe({
        addMembers: runSpaceAddMembersMock,
        env: { CODEX_THREAD_ID: "codex-thread" },
        projectFolders: { projectFolder: [project] },
        space: SPACE_ID,
        workingDirectory: project,
      })
    ).rejects.toThrow(AGENT_ACTING_IDENTITY_RE);
    expect(createOpenMeldAgentProfileMock).not.toHaveBeenCalled();
    expect(ensureAgentProfileRuntimeBindingMock).not.toHaveBeenCalled();
    expect(runSpaceAddMembersMock).not.toHaveBeenCalled();
  });

  it("fails closed for Codex-like environments without CODEX_THREAD_ID", async () => {
    const { runSpaceAddMe } = await import("../src/space/add-me-command");
    let thrownError: Error | null = null;

    try {
      await runSpaceAddMe({
        addMembers: runSpaceAddMembersMock,
        env: { CODEX_SHELL: "1" },
        profile: HUMAN_PROFILE.openMeldProfileId,
        space: SPACE_ID,
      });
    } catch (error) {
      thrownError = error as Error;
    }
    expect(thrownError?.message).toMatch(CODEX_MISSING_THREAD_RE);
    expect(thrownError?.message).toContain("non-Codex shell");
    expect(thrownError?.message).not.toContain(
      "pass a Human Profile with --profile"
    );
    expect(runSpaceAddMembersMock).not.toHaveBeenCalled();
  });
});

function createPresenterCapture() {
  const lines: Array<{
    code: string;
    text: string;
    data?: Record<string, unknown>;
  }> = [];
  const payloads: Array<{ code: string; payload: unknown }> = [];
  return {
    view: "agent",
    event: vi.fn(),
    line: vi.fn((entry) => {
      lines.push(entry);
    }),
    data: vi.fn((entry) => {
      payloads.push(entry);
    }),
    lines,
    payloads,
  };
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

async function flushPromises(): Promise<void> {
  for (let index = 0; index < 10; index += 1) {
    await Promise.resolve();
  }
}
