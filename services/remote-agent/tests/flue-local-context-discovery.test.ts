import { defineAgent, defineSkill, type SessionEnv } from "@flue/runtime";
import { initializeRootHarness } from "@flue/runtime/internal";
import { describe, expect, it, vi } from "vitest";

describe("Flue local context discovery policy", () => {
  it("does not read Sandbox files when the agent disables local context discovery", async () => {
    const sessionEnv = createObservedSessionEnv();
    const agent = defineAgent(() => ({
      instructions: "Use only the supplied Center Agent instructions.",
      model: "test/model",
      sandbox: {
        createSessionEnv: async () => sessionEnv,
      },
      skipLocalContextDiscovery: true,
    }));

    await initializeRootHarness(
      agent,
      {
        agentConfig: {
          resolveModel: () => ({}) as never,
        },
        attachmentStore: {} as never,
        conversationWriter: {} as never,
        createDefaultEnv: async () => sessionEnv,
        env: {},
        id: "space_123",
      },
      () => undefined
    );

    expect(sessionEnv.exists).not.toHaveBeenCalled();
    expect(sessionEnv.readFile).not.toHaveBeenCalled();
    expect(sessionEnv.readdir).not.toHaveBeenCalled();
  });

  it("keeps definition-provided Skills in the model catalog when local discovery is disabled", async () => {
    const sessionEnv = createObservedSessionEnv();
    const skill = defineSkill({
      description: "Review a release using the Organization checklist.",
      files: {
        "references/checklist.md": "# Release checklist\n\nVerify rollback.",
      },
      instructions: "Read the checklist before reviewing the release.",
      name: "release-review",
    });
    const agent = defineAgent(() => ({
      instructions: "Use only the supplied Center Agent instructions.",
      model: "test/model",
      sandbox: {
        createSessionEnv: async () => sessionEnv,
      },
      skills: [skill],
      skipLocalContextDiscovery: true,
    }));

    const harness = await initializeRootHarness(
      agent,
      {
        agentConfig: {
          resolveModel: () => ({}) as never,
        },
        attachmentStore: {} as never,
        conversationWriter: {} as never,
        createDefaultEnv: async () => sessionEnv,
        env: {},
        id: "space_123",
      },
      () => undefined
    );
    const runtimeConfig = (
      harness as unknown as {
        config: {
          skills: Record<
            string,
            { description: string; name: string; packagedDirectory?: unknown }
          >;
          systemPrompt: string;
        };
      }
    ).config;

    expect(runtimeConfig.systemPrompt).toContain("## Available Skills");
    expect(runtimeConfig.systemPrompt).toContain(
      "- **release-review** — Review a release using the Organization checklist."
    );
    expect(runtimeConfig.skills["release-review"]).toMatchObject({
      description: "Review a release using the Organization checklist.",
      name: "release-review",
    });
    expect(sessionEnv.exists).not.toHaveBeenCalled();
    expect(sessionEnv.readFile).not.toHaveBeenCalled();
    expect(sessionEnv.readdir).not.toHaveBeenCalled();
  });
});

function createObservedSessionEnv(): SessionEnv {
  return {
    cwd: "/workspace",
    exec: vi.fn(async () => ({
      exitCode: 0,
      stderr: "",
      stdout: "",
    })),
    exists: vi.fn(async () => false),
    mkdir: vi.fn(async () => undefined),
    readFile: vi.fn(async () => ""),
    readFileBuffer: vi.fn(async () => new Uint8Array()),
    readdir: vi.fn(async () => []),
    resolvePath: (path) => (path.startsWith("/") ? path : `/workspace/${path}`),
    rm: vi.fn(async () => undefined),
    stat: vi.fn(async () => ({
      isDirectory: false,
      isFile: true,
    })),
    writeFile: vi.fn(async () => undefined),
  };
}
