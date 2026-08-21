import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  defaultManagedIntegrationPaths,
  installAgentActivityIntegrations,
  readAgentActivityIntegrationStatus,
  uninstallAgentActivityIntegrations,
} from "../src/agent-activity/managed-integrations";

let root: string | null = null;

afterEach(async () => {
  vi.unstubAllEnvs();
  if (root) {
    await rm(root, { force: true, recursive: true });
    root = null;
  }
});

describe("Agent Activity managed integrations", () => {
  it.each([
    "npx -y openmeld@latest",
    "openmeld-staging",
  ])("refuses to install a global dispatcher through the non-durable command %s", async (cliEntryCommand) => {
    vi.stubEnv("OPENMELD_USER_FACING_CLI_COMMAND", cliEntryCommand);
    root = await mkdtemp(join(tmpdir(), "openmeld-managed-activity-"));

    await expect(
      installAgentActivityIntegrations({
        paths: defaultManagedIntegrationPaths(root),
      })
    ).rejects.toThrow(
      "Agent Activity observers require an installed OpenMeld CLI lane"
    );
  });

  it.each([
    "openmeld-dev",
    "openmeld-canary",
  ])("keeps installed observers in the %s CLI lane", async (cliEntryCommand) => {
    vi.stubEnv("OPENMELD_USER_FACING_CLI_COMMAND", cliEntryCommand);
    root = await mkdtemp(join(tmpdir(), "openmeld-managed-activity-"));
    const paths = defaultManagedIntegrationPaths(root);

    await expect(installAgentActivityIntegrations({ paths })).resolves.toEqual({
      claude: "changed",
      codex: "changed",
      cursor: "changed",
      openCode: "changed",
    });

    const claudeSettings = JSON.parse(
      await readFile(paths.claudeSettingsPath, "utf8")
    );
    for (const event of [
      "Notification",
      "SessionEnd",
      "SessionStart",
      "StopFailure",
      "SubagentStart",
      "SubagentStop",
      "Stop",
      "TaskCompleted",
      "TaskCreated",
      "UserPromptSubmit",
    ]) {
      expect(claudeSettings.hooks[event].at(-1).hooks[0].command).toBe(
        `${cliEntryCommand} activity hook --provider claude-code --owner openmeld-agent-activity-v1`
      );
    }
    expect(await readFile(paths.codexConfigPath, "utf8")).toContain(
      `command = '${cliEntryCommand} activity hook --provider codex --owner openmeld-agent-activity-v1'`
    );
    for (const event of [
      "PermissionRequest",
      "SubagentStart",
      "SubagentStop",
    ]) {
      expect(await readFile(paths.codexConfigPath, "utf8")).toContain(
        `[[hooks.${event}]]`
      );
    }
    const cursorHooks = JSON.parse(
      await readFile(paths.cursorHooksPath, "utf8")
    );
    for (const event of [
      "beforeSubmitPrompt",
      "sessionEnd",
      "sessionStart",
      "stop",
    ]) {
      expect(cursorHooks.hooks[event].at(-1).command).toBe(
        `${cliEntryCommand} activity hook --provider cursor --owner openmeld-agent-activity-v1`
      );
    }
    const openCodePlugin = await readFile(paths.openCodePluginPath, "utf8");
    expect(openCodePlugin).toContain(
      `spawn("${cliEntryCommand}", ["activity", "context"`
    );
    expect(openCodePlugin).toContain(
      `"${cliEntryCommand}",\n        ["activity", "hook"`
    );
    expect(openCodePlugin).toContain("session_title: sessionTitle");
    await expect(readAgentActivityIntegrationStatus(paths)).resolves.toEqual({
      claude: true,
      codex: true,
      cursor: true,
      openCode: true,
    });

    await expect(
      uninstallAgentActivityIntegrations({ paths })
    ).resolves.toEqual({
      claude: "changed",
      codex: "changed",
      cursor: "changed",
      openCode: "changed",
    });
    await expect(readAgentActivityIntegrationStatus(paths)).resolves.toEqual({
      claude: false,
      codex: false,
      cursor: false,
      openCode: false,
    });
  });

  it("coexists with Agent Router, installs idempotently, and uninstalls only OpenMeld entries", async () => {
    root = await mkdtemp(join(tmpdir(), "openmeld-managed-activity-"));
    const paths = defaultManagedIntegrationPaths(root);
    await Promise.all([
      mkdir(join(root, ".claude"), { recursive: true }),
      mkdir(join(root, ".codex"), { recursive: true }),
      mkdir(join(root, ".cursor"), { recursive: true }),
    ]);
    const claudeRouterHook = {
      hooks: [
        {
          command: "agents-router ingest --source claude_code",
          timeout: 10,
          type: "command",
        },
      ],
    };
    await writeFile(
      paths.claudeSettingsPath,
      `${JSON.stringify({ hooks: { Stop: [claudeRouterHook] }, theme: "dark" }, null, 2)}\n`
    );
    await writeFile(
      paths.codexConfigPath,
      "[hooks]\n[[hooks.Stop]]\n[[hooks.Stop.hooks]]\ncommand = 'agents-router ingest --source codex_cli'\n"
    );
    const cursorUserHook = {
      command: "my-cursor-observer --event stop",
      timeout: 5,
    };
    await writeFile(
      paths.cursorHooksPath,
      `${JSON.stringify(
        {
          hooks: { stop: [cursorUserHook] },
          version: 1,
        },
        null,
        2
      )}\n`
    );

    await expect(installAgentActivityIntegrations({ paths })).resolves.toEqual({
      claude: "changed",
      codex: "changed",
      cursor: "changed",
      openCode: "changed",
    });
    await expect(installAgentActivityIntegrations({ paths })).resolves.toEqual({
      claude: "reused",
      codex: "reused",
      cursor: "reused",
      openCode: "reused",
    });

    const installedClaude = JSON.parse(
      await readFile(paths.claudeSettingsPath, "utf8")
    );
    expect(installedClaude.theme).toBe("dark");
    expect(installedClaude.hooks.Stop[0]).toEqual(claudeRouterHook);
    expect(installedClaude.hooks.Stop).toHaveLength(2);
    expect(await readFile(paths.codexConfigPath, "utf8")).toContain(
      "agents-router ingest --source codex_cli"
    );
    const installedCursor = JSON.parse(
      await readFile(paths.cursorHooksPath, "utf8")
    );
    expect(installedCursor.hooks.stop[0]).toEqual(cursorUserHook);
    expect(installedCursor.hooks.stop).toHaveLength(2);
    const installedOpenCode = await readFile(paths.openCodePluginPath, "utf8");
    expect(installedOpenCode).toContain(
      "OpenMeldAgentActivityPlugin = async ({ client, directory })"
    );
    expect(installedOpenCode).toContain(
      "return resolved ?? directory ?? null;"
    );
    expect(installedOpenCode).toContain(
      ": directory ?? null;\n    if (!sessionDirectory) return;"
    );
    expect(installedOpenCode).toContain(
      "const resolveSessionTitle = async (sessionID, info)"
    );

    await expect(
      uninstallAgentActivityIntegrations({ paths })
    ).resolves.toEqual({
      claude: "changed",
      codex: "changed",
      cursor: "changed",
      openCode: "changed",
    });
    const uninstalledClaude = JSON.parse(
      await readFile(paths.claudeSettingsPath, "utf8")
    );
    expect(uninstalledClaude.hooks.Stop).toEqual([claudeRouterHook]);
    expect(await readFile(paths.codexConfigPath, "utf8")).toContain(
      "agents-router ingest --source codex_cli"
    );
    const uninstalledCursor = JSON.parse(
      await readFile(paths.cursorHooksPath, "utf8")
    );
    expect(uninstalledCursor.hooks.stop).toEqual([cursorUserHook]);
    await expect(
      readFile(paths.openCodePluginPath, "utf8")
    ).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("lets every lane safely maintain the shared global dispatcher", async () => {
    root = await mkdtemp(join(tmpdir(), "openmeld-managed-activity-"));
    const paths = defaultManagedIntegrationPaths(root);
    vi.stubEnv("OPENMELD_USER_FACING_CLI_COMMAND", "openmeld-dev");
    await installAgentActivityIntegrations({ paths });
    vi.stubEnv("OPENMELD_USER_FACING_CLI_COMMAND", "openmeld-canary");
    await expect(readAgentActivityIntegrationStatus(paths)).resolves.toEqual({
      claude: true,
      codex: true,
      cursor: true,
      openCode: true,
    });
    await expect(installAgentActivityIntegrations({ paths })).resolves.toEqual({
      claude: "changed",
      codex: "changed",
      cursor: "changed",
      openCode: "changed",
    });
    for (const value of await Promise.all([
      readFile(paths.claudeSettingsPath, "utf8"),
      readFile(paths.codexConfigPath, "utf8"),
      readFile(paths.cursorHooksPath, "utf8"),
      readFile(paths.openCodePluginPath, "utf8"),
    ])) {
      expect(value).toContain("openmeld-canary");
      expect(value).not.toContain("openmeld-dev activity");
    }

    vi.stubEnv("OPENMELD_USER_FACING_CLI_COMMAND", "openmeld-dev");
    await expect(readAgentActivityIntegrationStatus(paths)).resolves.toEqual({
      claude: true,
      codex: true,
      cursor: true,
      openCode: true,
    });
    await expect(
      uninstallAgentActivityIntegrations({ paths })
    ).resolves.toEqual({
      claude: "changed",
      codex: "changed",
      cursor: "changed",
      openCode: "changed",
    });
  });

  it("preserves Codex trust state written inside the managed hook markers", async () => {
    root = await mkdtemp(join(tmpdir(), "openmeld-managed-activity-"));
    const paths = defaultManagedIntegrationPaths(root);
    vi.stubEnv("OPENMELD_USER_FACING_CLI_COMMAND", "openmeld-dev");
    await installAgentActivityIntegrations({ paths });

    const trustState = `[hooks.state]
[hooks.state."/Users/example/.codex/config.toml:stop:0:0"]
enabled = false
trusted_hash = "sha256:example"`;
    const installed = await readFile(paths.codexConfigPath, "utf8");
    await writeFile(
      paths.codexConfigPath,
      installed.replace(
        "# openmeld-agent-activity:end:v1",
        `${trustState}\n# openmeld-agent-activity:end:v1`
      )
    );

    await expect(readAgentActivityIntegrationStatus(paths)).resolves.toEqual({
      claude: true,
      codex: true,
      cursor: true,
      openCode: true,
    });
    await expect(installAgentActivityIntegrations({ paths })).resolves.toEqual({
      claude: "reused",
      codex: "changed",
      cursor: "reused",
      openCode: "reused",
    });

    const repaired = await readFile(paths.codexConfigPath, "utf8");
    expect(repaired).toContain(
      `# openmeld-agent-activity:end:v1\n${trustState}`
    );
    expect(repaired).not.toContain(
      `${trustState}\n# openmeld-agent-activity:end:v1`
    );

    await expect(
      uninstallAgentActivityIntegrations({ paths })
    ).resolves.toEqual({
      claude: "changed",
      codex: "changed",
      cursor: "changed",
      openCode: "changed",
    });
    expect(await readFile(paths.codexConfigPath, "utf8")).toContain(trustState);
  });

  it("preserves Codex trust state inserted between managed hooks", async () => {
    root = await mkdtemp(join(tmpdir(), "openmeld-managed-activity-"));
    const paths = defaultManagedIntegrationPaths(root);
    vi.stubEnv("OPENMELD_USER_FACING_CLI_COMMAND", "openmeld-dev");
    await installAgentActivityIntegrations({ paths });

    const trustState = `[hooks.state]
[hooks.state."/Users/example/.codex/config.toml:session_start:0:0"]
trusted_hash = "sha256:session-start"

[hooks.state."/Users/example/.codex/config.toml:stop:0:0"]
enabled = false
trusted_hash = "sha256:stop"`;
    const installed = await readFile(paths.codexConfigPath, "utf8");
    await writeFile(
      paths.codexConfigPath,
      installed.replace(
        "\n\n[[hooks.Stop]]",
        `\n\n${trustState}\n\n[[hooks.Stop]]`
      )
    );

    await expect(readAgentActivityIntegrationStatus(paths)).resolves.toEqual({
      claude: true,
      codex: true,
      cursor: true,
      openCode: true,
    });
    await expect(installAgentActivityIntegrations({ paths })).resolves.toEqual({
      claude: "reused",
      codex: "changed",
      cursor: "reused",
      openCode: "reused",
    });

    const repaired = await readFile(paths.codexConfigPath, "utf8");
    expect(repaired).toContain(
      `# openmeld-agent-activity:end:v1\n${trustState}`
    );
    expect(repaired).not.toContain(`${trustState}\n\n[[hooks.Stop]]`);
  });

  it("still refuses to overwrite a modified OpenMeld-owned Codex hook", async () => {
    root = await mkdtemp(join(tmpdir(), "openmeld-managed-activity-"));
    const paths = defaultManagedIntegrationPaths(root);
    await installAgentActivityIntegrations({ paths });
    const installed = await readFile(paths.codexConfigPath, "utf8");
    const modified = installed.replace(
      "# openmeld-agent-activity:end:v1",
      "timeout = 11\n# openmeld-agent-activity:end:v1"
    );
    await writeFile(paths.codexConfigPath, modified);

    await expect(installAgentActivityIntegrations({ paths })).rejects.toThrow(
      "OpenMeld-owned Codex hook block was modified"
    );
    expect(await readFile(paths.codexConfigPath, "utf8")).toBe(modified);
  });

  it("fails closed when a user edits a config between read and replace", async () => {
    root = await mkdtemp(join(tmpdir(), "openmeld-managed-activity-"));
    const paths = defaultManagedIntegrationPaths(root);
    await mkdir(join(root, ".codex"), { recursive: true });
    await writeFile(paths.codexConfigPath, "[features]\nhooks = true\n");
    let changed = false;

    await expect(
      installAgentActivityIntegrations({
        beforeCommit: async (path) => {
          if (path === paths.codexConfigPath && !changed) {
            changed = true;
            await writeFile(
              path,
              "[features]\nhooks = true\n# user concurrent edit\n"
            );
          }
        },
        paths,
      })
    ).rejects.toThrow("revision changed before commit");
    expect(await readFile(paths.codexConfigPath, "utf8")).toContain(
      "# user concurrent edit"
    );
    expect(await readFile(paths.codexConfigPath, "utf8")).not.toContain(
      "openmeld-agent-activity:begin"
    );
    await expect(
      readFile(paths.openCodePluginPath, "utf8")
    ).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("upgrades only an exact older OpenMeld-owned integration", async () => {
    root = await mkdtemp(join(tmpdir(), "openmeld-managed-activity-"));
    const paths = defaultManagedIntegrationPaths(root);
    await installAgentActivityIntegrations({ paths });
    const replaceOwner = (value: string) =>
      value
        .replaceAll("openmeld-agent-activity-v1", "openmeld-agent-activity-v0")
        .replace("begin:v1", "begin:v0")
        .replace("end:v1", "end:v0");
    await Promise.all([
      readFile(paths.claudeSettingsPath, "utf8").then(async (value) =>
        writeFile(paths.claudeSettingsPath, replaceOwner(value))
      ),
      readFile(paths.codexConfigPath, "utf8").then(async (value) =>
        writeFile(paths.codexConfigPath, replaceOwner(value))
      ),
      readFile(paths.cursorHooksPath, "utf8").then(async (value) =>
        writeFile(paths.cursorHooksPath, replaceOwner(value))
      ),
      readFile(paths.openCodePluginPath, "utf8").then(async (value) =>
        writeFile(paths.openCodePluginPath, replaceOwner(value))
      ),
    ]);

    vi.stubEnv("OPENMELD_USER_FACING_CLI_COMMAND", "openmeld-dev");
    await expect(installAgentActivityIntegrations({ paths })).resolves.toEqual({
      claude: "changed",
      codex: "changed",
      cursor: "changed",
      openCode: "changed",
    });
    for (const path of [
      paths.claudeSettingsPath,
      paths.codexConfigPath,
      paths.cursorHooksPath,
      paths.openCodePluginPath,
    ]) {
      const value = await readFile(path, "utf8");
      expect(value).toContain("openmeld-agent-activity-v1");
      expect(value).not.toContain("openmeld-agent-activity-v0");
      expect(value).toContain("openmeld-dev");
    }
  });

  it("upgrades the exact pre-task-lifecycle Codex hook block", async () => {
    root = await mkdtemp(join(tmpdir(), "openmeld-managed-activity-"));
    const paths = defaultManagedIntegrationPaths(root);
    await installAgentActivityIntegrations({ paths });
    let previous = await readFile(paths.codexConfigPath, "utf8");
    for (const event of [
      "PermissionRequest",
      "SubagentStart",
      "SubagentStop",
    ]) {
      previous = previous.replace(
        new RegExp(
          `\\n\\n\\[\\[hooks\\.${event}\\]\\][\\s\\S]*?type = 'command'`
        ),
        ""
      );
    }
    await writeFile(paths.codexConfigPath, previous);

    await expect(readAgentActivityIntegrationStatus(paths)).resolves.toEqual({
      claude: true,
      codex: false,
      cursor: true,
      openCode: true,
    });
    await expect(installAgentActivityIntegrations({ paths })).resolves.toEqual({
      claude: "reused",
      codex: "changed",
      cursor: "reused",
      openCode: "reused",
    });
    const upgraded = await readFile(paths.codexConfigPath, "utf8");
    expect(upgraded).toContain("[[hooks.PermissionRequest]]");
    expect(upgraded).toContain("[[hooks.SubagentStart]]");
    expect(upgraded).toContain("[[hooks.SubagentStop]]");
  });

  it("upgrades the exact pre-directory-fallback OpenCode plugin", async () => {
    root = await mkdtemp(join(tmpdir(), "openmeld-managed-activity-"));
    const paths = defaultManagedIntegrationPaths(root);
    await installAgentActivityIntegrations({ paths });
    const current = await readFile(paths.openCodePluginPath, "utf8");
    const previous = current
      .replace(
        `    const sessionDirectory = typeof input.sessionID === "string" && input.sessionID
      ? await resolveSessionDirectory(input.sessionID)
      : directory ?? null;`,
        `    if (!input.sessionID) return;
    const sessionDirectory = await resolveSessionDirectory(input.sessionID);`
      )
      .replace("async ({ client, directory })", "async ({ client })")
      .replace("return resolved ?? directory ?? null;", "return resolved;")
      .replace("return directory ?? null;", "return null;");
    await writeFile(paths.openCodePluginPath, previous);

    await expect(installAgentActivityIntegrations({ paths })).resolves.toEqual({
      claude: "reused",
      codex: "reused",
      cursor: "reused",
      openCode: "changed",
    });
    expect(await readFile(paths.openCodePluginPath, "utf8")).toBe(current);
  });

  it("upgrades the exact pre-session-id-fallback OpenCode plugin", async () => {
    root = await mkdtemp(join(tmpdir(), "openmeld-managed-activity-"));
    const paths = defaultManagedIntegrationPaths(root);
    await installAgentActivityIntegrations({ paths });
    const current = await readFile(paths.openCodePluginPath, "utf8");
    const previous = current.replace(
      `    const sessionDirectory = typeof input.sessionID === "string" && input.sessionID
      ? await resolveSessionDirectory(input.sessionID)
      : directory ?? null;`,
      `    if (!input.sessionID) return;
    const sessionDirectory = await resolveSessionDirectory(input.sessionID);`
    );
    await writeFile(paths.openCodePluginPath, previous);

    await expect(installAgentActivityIntegrations({ paths })).resolves.toEqual({
      claude: "reused",
      codex: "reused",
      cursor: "reused",
      openCode: "changed",
    });
    expect(await readFile(paths.openCodePluginPath, "utf8")).toBe(current);
  });

  it("refuses to remove a user-modified Claude hook group", async () => {
    root = await mkdtemp(join(tmpdir(), "openmeld-managed-activity-"));
    const paths = defaultManagedIntegrationPaths(root);
    await installAgentActivityIntegrations({ paths });
    const settings = JSON.parse(
      await readFile(paths.claudeSettingsPath, "utf8")
    );
    const owned = settings.hooks.Stop.at(-1).hooks[0];
    settings.hooks.Stop.at(-1).hooks = [
      { ...owned, timeout: 11 },
      { command: "agents-router ingest --source claude_code", type: "command" },
    ];
    await writeFile(
      paths.claudeSettingsPath,
      `${JSON.stringify(settings, null, 2)}\n`
    );

    const modified = `${JSON.stringify(settings, null, 2)}\n`;
    await expect(uninstallAgentActivityIntegrations({ paths })).rejects.toThrow(
      "Claude hook for Stop was modified"
    );
    expect(await readFile(paths.claudeSettingsPath, "utf8")).toBe(modified);
  });

  it("rolls back every replaced file when the final replace reports a failure", async () => {
    root = await mkdtemp(join(tmpdir(), "openmeld-managed-activity-"));
    const paths = defaultManagedIntegrationPaths(root);
    await mkdir(join(root, ".codex"), { recursive: true });
    await writeFile(paths.codexConfigPath, "[features]\nhooks = true\n");

    await expect(
      installAgentActivityIntegrations({
        afterReplace: (path) => {
          if (path === paths.openCodePluginPath) {
            throw new Error("simulated post-replace failure");
          }
        },
        paths,
      })
    ).rejects.toThrow("simulated post-replace failure");
    expect(await readFile(paths.codexConfigPath, "utf8")).toBe(
      "[features]\nhooks = true\n"
    );
    await expect(
      readFile(paths.claudeSettingsPath, "utf8")
    ).rejects.toMatchObject({ code: "ENOENT" });
    await expect(
      readFile(paths.openCodePluginPath, "utf8")
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("refuses to remove a user-modified OpenMeld plugin", async () => {
    root = await mkdtemp(join(tmpdir(), "openmeld-managed-activity-"));
    const paths = defaultManagedIntegrationPaths(root);
    await installAgentActivityIntegrations({ paths });
    await writeFile(
      paths.openCodePluginPath,
      `${await readFile(paths.openCodePluginPath, "utf8")}\n// user edit\n`
    );
    await expect(uninstallAgentActivityIntegrations({ paths })).rejects.toThrow(
      "OpenCode plugin was modified"
    );
    expect(await readFile(paths.openCodePluginPath, "utf8")).toContain(
      "// user edit"
    );
  });
});
