import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { refreshManagedAgentActivityIntegrations } from "../src/agent-activity/integration-refresh";
import { bindProject } from "../src/agent-activity/project-bindings";

let root: string | null = null;

afterEach(async () => {
  if (root) {
    await rm(root, { force: true, recursive: true });
    root = null;
  }
});

describe("managed Agent integration refresh", () => {
  it("does not install global hooks when this lane has no Project bindings", async () => {
    root = await mkdtemp(join(tmpdir(), "openmeld-integration-refresh-"));
    const install = vi.fn();
    const register = vi.fn();

    await expect(
      refreshManagedAgentActivityIntegrations({
        homeDir: root,
        install,
        register,
        rootDir: root,
      })
    ).resolves.toEqual({
      reason: "no_project_bindings",
      status: "skipped",
    });
    expect(register).not.toHaveBeenCalled();
    expect(install).not.toHaveBeenCalled();
  });

  it("refreshes only managed hooks when an existing Project binding is present", async () => {
    root = await mkdtemp(join(tmpdir(), "openmeld-integration-refresh-"));
    const repositoryPath = join(root, "repository");
    await mkdir(repositoryPath, { recursive: true });
    await bindProject({
      organizationId: "org-1",
      projectId: "project-1",
      projectSlug: "openmeld",
      repositoryFingerprint: null,
      repositoryPath,
      rootDir: root,
    });
    const install = vi.fn().mockResolvedValue({
      claude: "changed",
      codex: "changed",
      cursor: "changed",
      openCode: "reused",
    });
    const register = vi.fn().mockResolvedValue(undefined);

    await expect(
      refreshManagedAgentActivityIntegrations({
        homeDir: root,
        install,
        register,
        rootDir: root,
      })
    ).resolves.toEqual({
      integrations: {
        claude: "changed",
        codex: "changed",
        cursor: "changed",
        openCode: "reused",
      },
      status: "ready",
    });
    expect(register).toHaveBeenCalledWith({ rootDir: root });
    expect(install).toHaveBeenCalledWith({
      paths: {
        claudeSettingsPath: join(root, ".claude", "settings.json"),
        codexConfigPath: join(root, ".codex", "config.toml"),
        cursorHooksPath: join(root, ".cursor", "hooks.json"),
        openCodePluginPath: join(
          root,
          ".config",
          "opencode",
          "plugins",
          "openmeld-agent-activity.js"
        ),
      },
    });
  });
});
