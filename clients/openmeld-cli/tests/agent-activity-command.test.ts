import { cliJsonOutputEnvelopeSchema } from "@openmeld/schemas";
import { Command } from "commander";
import { describe, expect, it, vi } from "vitest";
import {
  activateAgentActivityIntegrations,
  emitAgentActivitySnapshot,
  emitHumanAgentActivitySnapshot,
  resolveProjectId,
  toPublicAgentActivityBinding,
} from "../src/agent-activity/command";
import {
  registerAgentActivityCommands,
  registerProjectCommands,
} from "../src/agent-activity/registration";
import type { Presenter } from "../src/runtime/presenter/types";

const project = {
  archivedAtMs: null,
  canArchive: false,
  canManage: true,
  createdAtMs: 1,
  createdByUserId: "user-1",
  id: "project-1",
  name: "OpenMeld",
  organizationId: "org-1",
  repositoryFingerprint: null,
  slug: "openmeld",
  updatedAtMs: 1,
};

describe("Agent Activity CLI presentation", () => {
  it("runs the read operation from both the canonical parent and explicit alias", async () => {
    const canonicalRead = vi.fn(() => Promise.resolve());
    const canonical = createActivityProgram(canonicalRead);
    await canonical.parseAsync([
      "node",
      "openmeld",
      "activity",
      "--project",
      "openmeld",
      "--view",
      "agent",
    ]);
    expect(canonicalRead).toHaveBeenCalledWith(
      expect.objectContaining({ project: "openmeld", view: "agent" })
    );

    const aliasRead = vi.fn(() => Promise.resolve());
    const alias = createActivityProgram(aliasRead);
    await alias.parseAsync([
      "node",
      "openmeld",
      "activity",
      "read",
      "--member",
      "user-1",
    ]);
    expect(aliasRead).toHaveBeenCalledWith(
      expect.objectContaining({ member: "user-1" })
    );
  });

  it("keeps explicit JSON and Agent View on the read alias with global options", async () => {
    const read = vi.fn(() => Promise.resolve());
    const program = createActivityProgram(read, { withGlobalView: true });

    await program.parseAsync([
      "node",
      "openmeld",
      "activity",
      "read",
      "--project",
      "openmeld",
      "--view",
      "agent",
      "--json",
    ]);

    expect(read).toHaveBeenCalledWith(
      expect.objectContaining({
        json: true,
        project: "openmeld",
        view: "agent",
      })
    );
  });

  it("passes the managed hook provider through the activity option layer", async () => {
    const handlers = createActivityHandlers();
    const program = new Command().exitOverride();
    program.option("--view <mode>", "View mode", "auto");
    registerAgentActivityCommands(program, handlers);

    await program.parseAsync([
      "node",
      "openmeld",
      "activity",
      "hook",
      "--provider",
      "claude-code",
      "--owner",
      "openmeld-agent-activity-v1",
    ]);

    expect(handlers.hook).toHaveBeenCalledWith(
      expect.objectContaining({
        owner: "openmeld-agent-activity-v1",
        provider: "claude-code",
      })
    );
  });

  it("requires an explicit second command confirmation for unverified folders", async () => {
    const bind = vi.fn(() => Promise.resolve());
    const program = new Command().exitOverride();
    registerProjectCommands(program, {
      archive: vi.fn(() => Promise.resolve()),
      bind,
      connectionsList: vi.fn(() => Promise.resolve()),
      connectionsRemove: vi.fn(() => Promise.resolve()),
      connectionsSetDefault: vi.fn(() => Promise.resolve()),
      create: vi.fn(() => Promise.resolve()),
      list: vi.fn(() => Promise.resolve()),
      unbind: vi.fn(() => Promise.resolve()),
      update: vi.fn(() => Promise.resolve()),
    });

    await program.parseAsync([
      "node",
      "openmeld",
      "projects",
      "bind",
      "openmeld",
      "--path",
      "/work/repository",
    ]);
    await program.parseAsync([
      "node",
      "openmeld",
      "projects",
      "bind",
      "openmeld",
      "--path",
      "/work/repository",
      "--allow-unverified",
    ]);

    expect(bind).toHaveBeenNthCalledWith(
      1,
      "openmeld",
      expect.objectContaining({
        allowUnverified: false,
        path: "/work/repository",
      }),
      expect.any(Command)
    );
    expect(bind).toHaveBeenNthCalledWith(
      2,
      "openmeld",
      expect.objectContaining({
        allowUnverified: true,
        path: "/work/repository",
      }),
      expect.any(Command)
    );
  });

  it("registers explicit multi-connection Project commands", async () => {
    const handlers = createProjectHandlers();
    const program = new Command().exitOverride();
    registerProjectCommands(program, handlers);

    await program.parseAsync([
      "node",
      "openmeld",
      "projects",
      "connections",
      "list",
      "openmeld",
      "--json",
    ]);
    await program.parseAsync([
      "node",
      "openmeld",
      "projects",
      "connections",
      "set-default",
      "openmeld",
      "--generation",
      "generation-2",
    ]);
    await program.parseAsync([
      "node",
      "openmeld",
      "projects",
      "connections",
      "remove",
      "openmeld",
      "--path",
      "/work/repository",
      "--replacement-generation",
      "generation-1",
    ]);

    expect(handlers.connectionsList).toHaveBeenCalledWith(
      "openmeld",
      expect.objectContaining({ json: true }),
      expect.any(Command)
    );
    expect(handlers.connectionsSetDefault).toHaveBeenCalledWith(
      "openmeld",
      expect.objectContaining({ generation: "generation-2" }),
      expect.any(Command)
    );
    expect(handlers.connectionsRemove).toHaveBeenCalledWith(
      "openmeld",
      expect.objectContaining({
        path: "/work/repository",
        replacementGeneration: "generation-1",
      }),
      expect.any(Command)
    );
  });

  it.each([
    { command: ["context", "--path", "/tmp/repository"], handler: "context" },
    { command: ["install"], handler: "install" },
    { command: ["uninstall"], handler: "uninstall" },
    { command: ["status"], handler: "status" },
    { command: ["health"], handler: "health" },
    { command: ["sync"], handler: "sync" },
  ] as const)("passes parsed --json options to activity $handler", async ({
    command,
    handler,
  }) => {
    const handlers = createActivityHandlers();
    const program = new Command().exitOverride();
    registerAgentActivityCommands(program, handlers);

    await program.parseAsync([
      "node",
      "openmeld",
      "activity",
      ...command,
      "--json",
    ]);

    expect(handlers[handler]).toHaveBeenCalledWith(
      expect.objectContaining({ json: true })
    );
  });

  it("resolves the user-facing Project slug and fails loudly when absent", () => {
    expect(resolveProjectId([project], "openmeld")).toBe("project-1");
    expect(() => resolveProjectId([project], "missing")).toThrow(
      'Project "missing" was not found'
    );
    expect(
      resolveProjectId(
        [{ ...project, archivedAtMs: 1000, canManage: false }],
        "openmeld"
      )
    ).toBe("project-1");
  });

  it("keeps private binding generation out of projects list and bind JSON", () => {
    const binding = toPublicAgentActivityBinding({
      bindingGeneration: "private-generation",
      boundAtMs: 1000,
      isDefault: true,
      organizationId: "org-1",
      projectId: "project-1",
      projectSlug: "openmeld",
      repositoryFingerprint: null,
      repositoryPath: "/private/repository",
    });
    for (const envelope of [
      {
        binding,
        integrationSetup: {
          integrations: {
            claude: "changed",
            codex: "changed",
            cursor: "changed",
            openCode: "changed",
          },
          status: "ready",
        },
        project,
        schemaVersion: 1,
        type: "projects.bind",
      },
      {
        localBindings: [binding],
        organizationId: "org-1",
        projects: [project],
        schemaVersion: 1,
        type: "projects.list",
      },
    ]) {
      const parsed = cliJsonOutputEnvelopeSchema.parse(envelope);
      expect(JSON.stringify(parsed)).not.toContain("bindingGeneration");
      expect(JSON.stringify(parsed)).not.toContain("private-generation");
    }
  });

  it("does not count expired presence as active in Human View", () => {
    const lines: Array<{ code: string; text: string }> = [];
    emitHumanAgentActivitySnapshot({
      nowMs: 2000,
      organizationName: "OpenMeld",
      presenter: {
        data: vi.fn(),
        event: vi.fn(),
        line: (line) => lines.push(line),
        view: "human",
      },
      snapshot: {
        asOfMs: 1000,
        digests: [],
        digestsTruncated: false,
        organizationId: "org-1",
        projects: [project],
        recentEvents: [],
        sessions: [
          {
            clientKind: "codex-app",
            expiresAtMs: 2000,
            gitBranch: "main",
            gitCommit: null,
            id: "session-1",
            isActive: true,
            lastObservedAtMs: 1000,
            memberName: "Mira",
            memberUserId: "user-1",
            model: "gpt-5.6-sol",
            projectId: "project-1",
            provider: "codex",
            startedAtMs: 900,
            status: "active",
            title: "Agent Activity",
          },
        ],
        sessionsTruncated: false,
        stalenessThresholdMs: 300_000,
      },
    });

    const activeRow = lines.find(
      (line) =>
        line.code === "activity.read.row" && line.text.includes("Active now")
    );
    expect(activeRow?.text).toContain("Active now: 0");
  });

  it("keeps a successful Project binding explicit when observer setup needs attention", async () => {
    await expect(
      activateAgentActivityIntegrations({
        homeDir: "/tmp/openmeld-activity-bind-test",
        install: vi.fn(() => Promise.reject(new Error("CAS conflict"))),
      })
    ).resolves.toEqual({
      message:
        "The Project is connected, but OpenMeld could not install every managed observer. Run `openmeld activity install` from an installed OpenMeld CLI lane for details.",
      status: "needs_attention",
    });
  });

  it("registers the current lane before reporting managed observers ready", async () => {
    const calls: string[] = [];
    await expect(
      activateAgentActivityIntegrations({
        homeDir: "/tmp/openmeld-activity-bind-test",
        install: vi.fn(() => {
          calls.push("install");
          return Promise.resolve({
            claude: "reused" as const,
            codex: "reused" as const,
            cursor: "reused" as const,
            openCode: "reused" as const,
          });
        }),
        register: vi.fn(() => {
          calls.push("register");
          return Promise.resolve();
        }),
        rootDir: "/tmp/custom-openmeld-home",
      })
    ).resolves.toMatchObject({ status: "ready" });
    expect(calls).toEqual(["register", "install"]);
  });

  it("emits stable Agent View result codes for every snapshot row", () => {
    const data = vi.fn<Presenter["data"]>();
    emitAgentActivitySnapshot(
      {
        data,
        event: vi.fn(),
        line: vi.fn(),
        view: "agent",
      },
      {
        asOfMs: 1000,
        digests: [],
        digestsTruncated: false,
        organizationId: "org-1",
        projects: [project],
        recentEvents: [
          {
            clientKind: "codex-app",
            eventId: "event-1",
            eventType: "session_active",
            memberName: "Felix",
            memberUserId: "user-1",
            observedAtMs: 1000,
            projectId: "project-1",
            provider: "codex",
            status: "active",
            title: null,
          },
        ],
        sessions: [],
        sessionsTruncated: false,
        stalenessThresholdMs: 300_000,
      }
    );
    expect(data.mock.calls.map(([entry]) => entry.code)).toEqual([
      "activity.snapshot",
      "activity.project",
      "activity.event",
    ]);
  });
});

function createActivityProgram(
  read: (options: unknown) => Promise<void>,
  options: { withGlobalView?: boolean } = {}
) {
  const program = new Command();
  program.exitOverride();
  if (options.withGlobalView) {
    program.option("--view <mode>", "View mode", "auto");
  }
  registerAgentActivityCommands(program, {
    ...createActivityHandlers(),
    read,
  });
  return program;
}

function createActivityHandlers() {
  return {
    context: vi.fn(() => Promise.resolve()),
    health: vi.fn(() => Promise.resolve()),
    hook: vi.fn(() => Promise.resolve()),
    install: vi.fn(() => Promise.resolve()),
    read: vi.fn(() => Promise.resolve()),
    status: vi.fn(() => Promise.resolve()),
    sync: vi.fn(() => Promise.resolve()),
    uninstall: vi.fn(() => Promise.resolve()),
  };
}

function createProjectHandlers() {
  return {
    archive: vi.fn(() => Promise.resolve()),
    bind: vi.fn(() => Promise.resolve()),
    connectionsList: vi.fn(() => Promise.resolve()),
    connectionsRemove: vi.fn(() => Promise.resolve()),
    connectionsSetDefault: vi.fn(() => Promise.resolve()),
    create: vi.fn(() => Promise.resolve()),
    list: vi.fn(() => Promise.resolve()),
    unbind: vi.fn(() => Promise.resolve()),
    update: vi.fn(() => Promise.resolve()),
  };
}
