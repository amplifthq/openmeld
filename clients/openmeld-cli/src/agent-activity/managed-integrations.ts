import { createHash, randomUUID } from "node:crypto";
import {
  chmod,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import { resolveUserFacingCliEntryCommand } from "../runtime/cli-entry-command";

export const AGENT_ACTIVITY_INTEGRATION_OWNER = "openmeld-agent-activity-v1";
const LEGACY_AGENT_ACTIVITY_INTEGRATION_OWNER = "openmeld-agent-activity-v0";

const CLAUDE_EVENTS = [
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
] as const;
const CURSOR_EVENTS = [
  "beforeSubmitPrompt",
  "sessionEnd",
  "sessionStart",
  "stop",
] as const;
const CODEX_EVENTS = [
  "SessionStart",
  "UserPromptSubmit",
  "Stop",
  "PermissionRequest",
  "SubagentStart",
  "SubagentStop",
] as const;
const PRE_TASK_LIFECYCLE_CODEX_EVENTS = [
  "SessionStart",
  "UserPromptSubmit",
  "Stop",
] as const;
const AGENT_ACTIVITY_CLI_ENTRY_COMMANDS = [
  "openmeld",
  "openmeld-dev",
  "openmeld-canary",
] as const;

type AgentActivityCliEntryCommand =
  (typeof AGENT_ACTIVITY_CLI_ENTRY_COMMANDS)[number];

type ManagedIntegrationArtifacts = {
  claudeCommand: string;
  codexBlock: string;
  cursorCommand: string;
  legacyClaudeCommand: string;
  legacyCodexBlock: string;
  legacyCursorCommand: string;
  legacyOpenCodePlugin: string;
  openCodePlugin: string;
  preDirectoryFallbackLegacyOpenCodePlugin: string;
  preDirectoryFallbackOpenCodePlugin: string;
  preTaskLifecycleCodexBlock: string;
  preTaskLifecycleLegacyCodexBlock: string;
  preSessionIdFallbackLegacyOpenCodePlugin: string;
  preSessionIdFallbackOpenCodePlugin: string;
};

function buildCodexBlock(input: {
  cliEntryCommand: AgentActivityCliEntryCommand;
  events?: readonly (typeof CODEX_EVENTS)[number][];
  markerVersion: "v0" | "v1";
  owner: string;
}) {
  const command = `${input.cliEntryCommand} activity hook --provider codex --owner ${input.owner}`;
  const blocks = (input.events ?? CODEX_EVENTS).map((event) => {
    const statusMessage =
      event === "SessionStart"
        ? "\nstatusMessage = 'Sharing safe Agent Activity metadata'"
        : "";
    return `[[hooks.${event}]]
[[hooks.${event}.hooks]]
command = '${command}'${statusMessage}
timeout = 10
type = 'command'`;
  });
  return `
# openmeld-agent-activity:begin:${input.markerVersion}
${blocks.join("\n\n")}
# openmeld-agent-activity:end:${input.markerVersion}
`;
}

function buildOpenCodePlugin(input: {
  cliEntryCommand: AgentActivityCliEntryCommand;
  owner: string;
}) {
  return `// ${input.owner}
import { spawn } from "node:child_process";

const readOpenMeldContext = (directory) => new Promise((resolve) => {
  let stdout = "";
  const child = spawn("${input.cliEntryCommand}", ["activity", "context", "--path", directory, "--json"], {
    stdio: ["ignore", "pipe", "ignore"],
  });
  const finish = () => {
    try {
      const value = JSON.parse(stdout);
      resolve(typeof value.context === "string" ? value.context : null);
    } catch {
      resolve(null);
    }
  };
  const timeout = setTimeout(() => {
    child.kill();
    resolve(null);
  }, 2000);
  timeout.unref();
  child.stdout.on("data", (chunk) => {
    if (stdout.length < 16_384) stdout += String(chunk);
  });
  child.once("error", () => {
    clearTimeout(timeout);
    resolve(null);
  });
  child.once("exit", () => {
    clearTimeout(timeout);
    finish();
  });
});

const ALLOWED_EVENTS = new Set([
  "session.created",
  "session.updated",
  "session.deleted",
  "session.status",
  "session.idle",
  "session.error",
]);

export const OpenMeldAgentActivityPlugin = async ({ client, directory }) => {
  const sessionDirectories = new Map();
  const sessionTitles = new Map();
  const resolveSessionDirectory = async (sessionID, info) => {
    const direct = typeof info?.directory === "string" ? info.directory : null;
    if (direct) {
      sessionDirectories.set(sessionID, direct);
      return direct;
    }
    const cached = sessionDirectories.get(sessionID);
    if (cached) return cached;
    try {
      const response = await client.session.get({ path: { id: sessionID } });
      const resolved = typeof response?.data?.directory === "string"
        ? response.data.directory
        : null;
      if (resolved) sessionDirectories.set(sessionID, resolved);
      return resolved ?? directory ?? null;
    } catch {
      return directory ?? null;
    }
  };
  const resolveSessionTitle = async (sessionID, info) => {
    const direct = typeof info?.title === "string" ? info.title : null;
    if (direct) {
      sessionTitles.set(sessionID, direct);
      return direct;
    }
    const cached = sessionTitles.get(sessionID);
    if (cached) return cached;
    try {
      const response = await client.session.get({ path: { id: sessionID } });
      const resolved = typeof response?.data?.title === "string"
        ? response.data.title
        : null;
      if (resolved) sessionTitles.set(sessionID, resolved);
      return resolved;
    } catch {
      return null;
    }
  };

  return ({
  "experimental.chat.system.transform": async (input, output) => {
    const sessionDirectory = typeof input.sessionID === "string" && input.sessionID
      ? await resolveSessionDirectory(input.sessionID)
      : directory ?? null;
    if (!sessionDirectory) return;
    const context = await readOpenMeldContext(sessionDirectory);
    if (context) output.system.push(context);
  },
  event: async ({ event }) => {
    if (!ALLOWED_EVENTS.has(event.type)) return;
    const properties = event.properties ?? {};
    const info = properties.info ?? {};
    const sessionID = properties.sessionID ?? info.id ?? null;
    if (typeof sessionID !== "string" || !sessionID) return;
    const sessionDirectory = await resolveSessionDirectory(sessionID, info);
    if (!sessionDirectory) return;
    const sessionTitle = await resolveSessionTitle(sessionID, info);
    const payload = {
      cwd: sessionDirectory,
      hook_event_name: event.type,
      session_id: sessionID,
      session_title: sessionTitle,
      status: properties.status?.type ?? null,
    };
    await new Promise((resolve) => {
      const child = spawn(
        "${input.cliEntryCommand}",
        ["activity", "hook", "--provider", "opencode", "--owner", "${input.owner}"],
        { stdio: ["pipe", "ignore", "ignore"] }
      );
      const finish = () => resolve(undefined);
      const timeout = setTimeout(() => {
        child.kill();
        finish();
      }, 2000);
      timeout.unref();
      child.once("error", () => {
        clearTimeout(timeout);
        finish();
      });
      child.once("exit", () => {
        clearTimeout(timeout);
        finish();
      });
      child.stdin.end(JSON.stringify(payload));
    });
    if (event.type === "session.deleted") {
      sessionDirectories.delete(sessionID);
      sessionTitles.delete(sessionID);
    }
  },
  });
};
`;
}

function buildPreSessionIdFallbackOpenCodePlugin(openCodePlugin: string) {
  return openCodePlugin.replace(
    `    const sessionDirectory = typeof input.sessionID === "string" && input.sessionID
      ? await resolveSessionDirectory(input.sessionID)
      : directory ?? null;`,
    `    if (!input.sessionID) return;
    const sessionDirectory = await resolveSessionDirectory(input.sessionID);`
  );
}

function buildPreDirectoryFallbackOpenCodePlugin(
  preSessionIdFallbackOpenCodePlugin: string
) {
  return preSessionIdFallbackOpenCodePlugin
    .replace("async ({ client, directory })", "async ({ client })")
    .replace("return resolved ?? directory ?? null;", "return resolved;")
    .replace("return directory ?? null;", "return null;");
}

export function resolveAgentActivityDispatcherCommand(): AgentActivityCliEntryCommand | null {
  const cliEntryCommand = resolveUserFacingCliEntryCommand();
  return (
    AGENT_ACTIVITY_CLI_ENTRY_COMMANDS.find(
      (supportedCommand) => supportedCommand === cliEntryCommand
    ) ?? null
  );
}

function buildManagedIntegrationArtifacts(
  cliEntryCommand = requireAgentActivityDispatcherCommand()
): ManagedIntegrationArtifacts {
  const openCodePlugin = buildOpenCodePlugin({
    cliEntryCommand,
    owner: AGENT_ACTIVITY_INTEGRATION_OWNER,
  });
  const legacyOpenCodePlugin = buildOpenCodePlugin({
    cliEntryCommand: "openmeld",
    owner: LEGACY_AGENT_ACTIVITY_INTEGRATION_OWNER,
  });
  const preSessionIdFallbackOpenCodePlugin =
    buildPreSessionIdFallbackOpenCodePlugin(openCodePlugin);
  const preSessionIdFallbackLegacyOpenCodePlugin =
    buildPreSessionIdFallbackOpenCodePlugin(legacyOpenCodePlugin);
  return {
    claudeCommand: `${cliEntryCommand} activity hook --provider claude-code --owner ${AGENT_ACTIVITY_INTEGRATION_OWNER}`,
    codexBlock: buildCodexBlock({
      cliEntryCommand,
      markerVersion: "v1",
      owner: AGENT_ACTIVITY_INTEGRATION_OWNER,
    }),
    cursorCommand: `${cliEntryCommand} activity hook --provider cursor --owner ${AGENT_ACTIVITY_INTEGRATION_OWNER}`,
    legacyClaudeCommand: `openmeld activity hook --provider claude-code --owner ${LEGACY_AGENT_ACTIVITY_INTEGRATION_OWNER}`,
    legacyCodexBlock: buildCodexBlock({
      cliEntryCommand: "openmeld",
      markerVersion: "v0",
      owner: LEGACY_AGENT_ACTIVITY_INTEGRATION_OWNER,
    }),
    legacyCursorCommand: `openmeld activity hook --provider cursor --owner ${LEGACY_AGENT_ACTIVITY_INTEGRATION_OWNER}`,
    legacyOpenCodePlugin,
    openCodePlugin,
    preDirectoryFallbackLegacyOpenCodePlugin:
      buildPreDirectoryFallbackOpenCodePlugin(
        preSessionIdFallbackLegacyOpenCodePlugin
      ),
    preDirectoryFallbackOpenCodePlugin: buildPreDirectoryFallbackOpenCodePlugin(
      preSessionIdFallbackOpenCodePlugin
    ),
    preSessionIdFallbackLegacyOpenCodePlugin,
    preSessionIdFallbackOpenCodePlugin,
    preTaskLifecycleCodexBlock: buildCodexBlock({
      cliEntryCommand,
      events: PRE_TASK_LIFECYCLE_CODEX_EVENTS,
      markerVersion: "v1",
      owner: AGENT_ACTIVITY_INTEGRATION_OWNER,
    }),
    preTaskLifecycleLegacyCodexBlock: buildCodexBlock({
      cliEntryCommand: "openmeld",
      events: PRE_TASK_LIFECYCLE_CODEX_EVENTS,
      markerVersion: "v0",
      owner: LEGACY_AGENT_ACTIVITY_INTEGRATION_OWNER,
    }),
  };
}

function requireAgentActivityDispatcherCommand(): AgentActivityCliEntryCommand {
  const cliEntryCommand = resolveAgentActivityDispatcherCommand();
  if (!cliEntryCommand) {
    throw new Error(
      "Agent Activity observers require an installed OpenMeld CLI lane: openmeld, openmeld-dev, or openmeld-canary. Run the installed CLI directly instead of an ephemeral or custom command."
    );
  }
  return cliEntryCommand;
}

function buildKnownManagedIntegrationArtifacts(): ManagedIntegrationArtifacts[] {
  return AGENT_ACTIVITY_CLI_ENTRY_COMMANDS.map((cliEntryCommand) =>
    buildManagedIntegrationArtifacts(cliEntryCommand)
  );
}

export type ManagedIntegrationPaths = {
  claudeSettingsPath: string;
  codexConfigPath: string;
  cursorHooksPath: string;
  openCodePluginPath: string;
};

export function defaultManagedIntegrationPaths(
  homeDir: string
): ManagedIntegrationPaths {
  return {
    claudeSettingsPath: join(homeDir, ".claude", "settings.json"),
    codexConfigPath: join(homeDir, ".codex", "config.toml"),
    cursorHooksPath: join(homeDir, ".cursor", "hooks.json"),
    openCodePluginPath: join(
      homeDir,
      ".config",
      "opencode",
      "plugins",
      "openmeld-agent-activity.js"
    ),
  };
}

export async function installAgentActivityIntegrations(input: {
  afterReplace?: (path: string) => Promise<void> | void;
  beforeCommit?: (path: string) => Promise<void> | void;
  paths: ManagedIntegrationPaths;
}) {
  const artifacts = buildManagedIntegrationArtifacts();
  const knownArtifacts = buildKnownManagedIntegrationArtifacts();
  return await applyManagedIntegrationTransaction({
    afterReplace: input.afterReplace,
    beforeCommit: input.beforeCommit,
    plans: [
      await planTextUpdate(input.paths.codexConfigPath, "codex", (raw) =>
        installCodexBlock(raw, artifacts, knownArtifacts)
      ),
      await planTextUpdate(input.paths.claudeSettingsPath, "claude", (raw) =>
        installClaudeHooks(raw, artifacts, knownArtifacts)
      ),
      await planTextUpdate(input.paths.cursorHooksPath, "cursor", (raw) =>
        installCursorHooks(raw, artifacts, knownArtifacts)
      ),
      await planPluginInstall(
        input.paths.openCodePluginPath,
        artifacts,
        knownArtifacts
      ),
    ],
  });
}

export async function uninstallAgentActivityIntegrations(input: {
  afterReplace?: (path: string) => Promise<void> | void;
  beforeCommit?: (path: string) => Promise<void> | void;
  paths: ManagedIntegrationPaths;
}) {
  const knownArtifacts = buildKnownManagedIntegrationArtifacts();
  return await applyManagedIntegrationTransaction({
    afterReplace: input.afterReplace,
    beforeCommit: input.beforeCommit,
    plans: [
      await planTextUpdate(input.paths.codexConfigPath, "codex", (raw) =>
        uninstallCodexBlock(raw, knownArtifacts)
      ),
      await planTextUpdate(input.paths.claudeSettingsPath, "claude", (raw) =>
        uninstallClaudeHooks(raw, knownArtifacts)
      ),
      await planTextUpdate(input.paths.cursorHooksPath, "cursor", (raw) =>
        uninstallCursorHooks(raw, knownArtifacts)
      ),
      await planPluginUninstall(input.paths.openCodePluginPath, knownArtifacts),
    ],
  });
}

export async function readAgentActivityIntegrationStatus(
  paths: ManagedIntegrationPaths
) {
  const knownArtifacts = buildKnownManagedIntegrationArtifacts();
  const [claude, codex, cursor, openCode] = await Promise.all([
    readOptionalFile(paths.claudeSettingsPath),
    readOptionalFile(paths.codexConfigPath),
    readOptionalFile(paths.cursorHooksPath),
    readOptionalFile(paths.openCodePluginPath),
  ]);
  return {
    claude:
      claude !== null &&
      CLAUDE_EVENTS.every((event) => {
        try {
          const settings = parseSettings(claude);
          const hooks = isRecord(settings.hooks) ? settings.hooks : null;
          return (
            Array.isArray(hooks?.[event]) &&
            hooks[event].some((group) =>
              knownArtifacts.some((artifacts) =>
                hasOwnedClaudeHook(group, artifacts)
              )
            )
          );
        } catch {
          return false;
        }
      }),
    codex: codex !== null && hasCurrentCodexBlock(codex, knownArtifacts),
    cursor:
      cursor !== null &&
      CURSOR_EVENTS.every((event) => {
        try {
          const settings = parseJsonObject(cursor, "Cursor hooks");
          const hooks = isRecord(settings.hooks) ? settings.hooks : null;
          return (
            Array.isArray(hooks?.[event]) &&
            hooks[event].some((entry) =>
              knownArtifacts.some((artifacts) =>
                isOwnedCursorHook(entry, artifacts.cursorCommand)
              )
            )
          );
        } catch {
          return false;
        }
      }),
    openCode: knownArtifacts.some(
      (artifacts) => openCode === artifacts.openCodePlugin
    ),
  };
}

type UpdateResult = "changed" | "missing" | "reused";

function installCodexBlock(
  raw: string,
  artifacts: ManagedIntegrationArtifacts,
  knownArtifacts: ManagedIntegrationArtifacts[]
) {
  if (raw.includes(artifacts.codexBlock.trim())) {
    return raw;
  }
  const ownedBlock = findKnownCodexBlock(raw, knownArtifacts);
  if (ownedBlock) {
    return raw.replace(
      ownedBlock.block,
      `${artifacts.codexBlock.trim()}${ownedBlock.preservedTail}`
    );
  }
  if (raw.includes("# openmeld-agent-activity:begin:")) {
    throw new Error(
      "OpenMeld-owned Codex hook block was modified; refusing to overwrite it."
    );
  }
  return `${raw.trimEnd()}${artifacts.codexBlock}`;
}

function uninstallCodexBlock(
  raw: string,
  knownArtifacts: ManagedIntegrationArtifacts[]
) {
  const ownedBlock = findKnownCodexBlock(raw, knownArtifacts);
  if (!ownedBlock) {
    if (raw.includes("# openmeld-agent-activity:begin:")) {
      throw new Error(
        "OpenMeld-owned Codex hook block was modified; refusing to remove it."
      );
    }
    return raw;
  }
  return `${raw
    .replace(ownedBlock.block, ownedBlock.preservedTail)
    .trimEnd()}\n`;
}

function installClaudeHooks(
  raw: string,
  artifacts: ManagedIntegrationArtifacts,
  knownArtifacts: ManagedIntegrationArtifacts[]
) {
  const settings = parseSettings(raw);
  const hooks = ensureRecord(settings, "hooks");
  for (const event of CLAUDE_EVENTS) {
    const groups = Array.isArray(hooks[event]) ? [...hooks[event]] : [];
    if (
      groups.some((group) =>
        hasUnknownOpenMeldClaudeHook(group, knownArtifacts)
      )
    ) {
      throw new Error(
        `OpenMeld-owned Claude hook for ${event} was modified; refusing to overwrite it.`
      );
    }
    const knownIndex = groups.findIndex((group) =>
      isKnownOwnedClaudeGroup(group, knownArtifacts)
    );
    if (knownIndex >= 0) {
      groups[knownIndex] = ownedClaudeGroup(artifacts);
    } else {
      groups.push(ownedClaudeGroup(artifacts));
    }
    hooks[event] = groups;
  }
  return `${JSON.stringify(settings, null, 2)}\n`;
}

function installCursorHooks(
  raw: string,
  artifacts: ManagedIntegrationArtifacts,
  knownArtifacts: ManagedIntegrationArtifacts[]
) {
  const settings = parseJsonObject(raw, "Cursor hooks");
  if (settings.version !== undefined && settings.version !== 1) {
    throw new Error("Cursor hooks version must be 1.");
  }
  settings.version = 1;
  const hooks = ensureRecord(settings, "hooks", "Cursor hooks");
  for (const event of CURSOR_EVENTS) {
    const entries = Array.isArray(hooks[event]) ? [...hooks[event]] : [];
    if (
      entries.some((entry) =>
        hasUnknownOpenMeldCursorHook(entry, knownArtifacts)
      )
    ) {
      throw new Error(
        `OpenMeld-owned Cursor hook for ${event} was modified; refusing to overwrite it.`
      );
    }
    const knownIndex = entries.findIndex((entry) =>
      isKnownOwnedCursorHook(entry, knownArtifacts)
    );
    const owned = ownedCursorHook(artifacts.cursorCommand);
    if (knownIndex >= 0) {
      entries[knownIndex] = owned;
    } else {
      entries.push(owned);
    }
    hooks[event] = entries;
  }
  return `${JSON.stringify(settings, null, 2)}\n`;
}

function uninstallCursorHooks(
  raw: string,
  knownArtifacts: ManagedIntegrationArtifacts[]
) {
  const settings = parseJsonObject(raw, "Cursor hooks");
  const hooks = isRecord(settings.hooks) ? settings.hooks : null;
  if (!hooks) {
    return raw;
  }
  for (const event of CURSOR_EVENTS) {
    if (!Array.isArray(hooks[event])) {
      continue;
    }
    if (
      hooks[event].some((entry) =>
        hasUnknownOpenMeldCursorHook(entry, knownArtifacts)
      )
    ) {
      throw new Error(
        `OpenMeld-owned Cursor hook for ${event} was modified; refusing to remove it.`
      );
    }
    hooks[event] = hooks[event].filter(
      (entry) => !isKnownOwnedCursorHook(entry, knownArtifacts)
    );
  }
  return `${JSON.stringify(settings, null, 2)}\n`;
}

function ownedCursorHook(command: string) {
  return { command, timeout: 10 };
}

function isOwnedCursorHook(value: unknown, command: string) {
  return (
    isRecord(value) &&
    Object.keys(value).length === 2 &&
    value.command === command &&
    value.timeout === 10
  );
}

function isKnownOwnedCursorHook(
  value: unknown,
  knownArtifacts: ManagedIntegrationArtifacts[]
) {
  return knownArtifacts.some(
    (artifacts) =>
      isOwnedCursorHook(value, artifacts.cursorCommand) ||
      isOwnedCursorHook(value, artifacts.legacyCursorCommand)
  );
}

function hasUnknownOpenMeldCursorHook(
  value: unknown,
  knownArtifacts: ManagedIntegrationArtifacts[]
) {
  return (
    isRecord(value) &&
    typeof value.command === "string" &&
    value.command.includes(" activity hook --provider cursor --owner ") &&
    value.command.includes("openmeld-agent-activity-") &&
    !isKnownOwnedCursorHook(value, knownArtifacts)
  );
}

function uninstallClaudeHooks(
  raw: string,
  knownArtifacts: ManagedIntegrationArtifacts[]
) {
  const settings = parseSettings(raw);
  const hooks = isRecord(settings.hooks) ? settings.hooks : null;
  if (!hooks) {
    return raw;
  }
  for (const event of CLAUDE_EVENTS) {
    if (!Array.isArray(hooks[event])) {
      continue;
    }
    if (
      hooks[event].some((group) =>
        hasUnknownOpenMeldClaudeHook(group, knownArtifacts)
      )
    ) {
      throw new Error(
        `OpenMeld-owned Claude hook for ${event} was modified; refusing to remove it.`
      );
    }
    hooks[event] = hooks[event].filter(
      (group) => !isKnownOwnedClaudeGroup(group, knownArtifacts)
    );
  }
  return `${JSON.stringify(settings, null, 2)}\n`;
}

function ownedClaudeGroup(artifacts: ManagedIntegrationArtifacts) {
  return {
    hooks: [
      {
        command: artifacts.claudeCommand,
        timeout: 10,
        type: "command",
      },
    ],
  };
}

function isOwnedClaudeGroup(
  value: unknown,
  artifacts: ManagedIntegrationArtifacts
) {
  if (
    !isRecord(value) ||
    Object.keys(value).length !== 1 ||
    !Array.isArray(value.hooks)
  ) {
    return false;
  }
  return (
    value.hooks.length === 1 &&
    isRecord(value.hooks[0]) &&
    value.hooks[0].command === artifacts.claudeCommand &&
    value.hooks[0].timeout === 10 &&
    value.hooks[0].type === "command" &&
    Object.keys(value.hooks[0]).length === 3
  );
}

function hasOwnedClaudeHook(
  value: unknown,
  artifacts: ManagedIntegrationArtifacts
) {
  return (
    isRecord(value) &&
    Array.isArray(value.hooks) &&
    value.hooks.some(
      (hook) => isRecord(hook) && hook.command === artifacts.claudeCommand
    )
  );
}

function hasUnknownOpenMeldClaudeHook(
  value: unknown,
  knownArtifacts: ManagedIntegrationArtifacts[]
) {
  return (
    isRecord(value) &&
    Array.isArray(value.hooks) &&
    value.hooks.some(
      (hook) =>
        isRecord(hook) &&
        typeof hook.command === "string" &&
        hook.command.includes(
          " activity hook --provider claude-code --owner "
        ) &&
        hook.command.includes("openmeld-agent-activity-")
    ) &&
    !isKnownOwnedClaudeGroup(value, knownArtifacts)
  );
}

function isLegacyOwnedClaudeGroup(
  value: unknown,
  artifacts: ManagedIntegrationArtifacts
) {
  return isOwnedClaudeGroupForCommand(value, artifacts.legacyClaudeCommand);
}

function isKnownOwnedClaudeGroup(
  value: unknown,
  knownArtifacts: ManagedIntegrationArtifacts[]
) {
  return knownArtifacts.some(
    (artifacts) =>
      isOwnedClaudeGroup(value, artifacts) ||
      isLegacyOwnedClaudeGroup(value, artifacts)
  );
}

function findKnownCodexBlock(
  raw: string,
  knownArtifacts: ManagedIntegrationArtifacts[]
): { block: string; preservedTail: string } | null {
  for (const artifacts of knownArtifacts) {
    for (const block of [
      artifacts.codexBlock,
      artifacts.legacyCodexBlock,
      artifacts.preTaskLifecycleCodexBlock,
      artifacts.preTaskLifecycleLegacyCodexBlock,
    ]) {
      const normalized = block.trim();
      if (raw.includes(normalized)) {
        return { block: normalized, preservedTail: "" };
      }
      const lines = normalized.split("\n");
      const endMarker = lines.at(-1);
      if (!endMarker) {
        continue;
      }
      const ownedPrefix = lines.slice(0, -1).join("\n");
      const ownedPrefixIndex = raw.indexOf(ownedPrefix);
      if (ownedPrefixIndex < 0) {
        continue;
      }
      const preservedTailStart = ownedPrefixIndex + ownedPrefix.length;
      const endMarkerIndex = raw.indexOf(endMarker, preservedTailStart);
      if (endMarkerIndex < 0) {
        continue;
      }
      const preservedTail = raw.slice(preservedTailStart, endMarkerIndex);
      if (!preservedTail.trimStart().startsWith("[hooks.state]")) {
        continue;
      }
      return {
        block: raw.slice(ownedPrefixIndex, endMarkerIndex + endMarker.length),
        preservedTail,
      };
    }
  }
  return null;
}

function hasCurrentCodexBlock(
  raw: string,
  knownArtifacts: ManagedIntegrationArtifacts[]
): boolean {
  return knownArtifacts.some((artifacts) =>
    [artifacts.codexBlock, artifacts.legacyCodexBlock].some((block) => {
      const normalized = block.trim();
      if (raw.includes(normalized)) {
        return true;
      }
      const lines = normalized.split("\n");
      const endMarker = lines.at(-1);
      if (!endMarker) {
        return false;
      }
      const ownedPrefix = lines.slice(0, -1).join("\n");
      const ownedPrefixIndex = raw.indexOf(ownedPrefix);
      const preservedTailStart = ownedPrefixIndex + ownedPrefix.length;
      const endMarkerIndex =
        ownedPrefixIndex < 0 ? -1 : raw.indexOf(endMarker, preservedTailStart);
      return (
        endMarkerIndex >= 0 &&
        raw
          .slice(preservedTailStart, endMarkerIndex)
          .trimStart()
          .startsWith("[hooks.state]")
      );
    })
  );
}

function isOwnedClaudeGroupForCommand(value: unknown, command: string) {
  if (
    !isRecord(value) ||
    Object.keys(value).length !== 1 ||
    !Array.isArray(value.hooks)
  ) {
    return false;
  }
  return (
    value.hooks.length === 1 &&
    isRecord(value.hooks[0]) &&
    value.hooks[0].command === command &&
    value.hooks[0].timeout === 10 &&
    value.hooks[0].type === "command" &&
    Object.keys(value.hooks[0]).length === 3
  );
}

type ManagedIntegrationPlan = {
  current: string | null;
  key: "claude" | "codex" | "cursor" | "openCode";
  next: string | null;
  path: string;
  result: UpdateResult;
};

async function planPluginInstall(
  path: string,
  artifacts: ManagedIntegrationArtifacts,
  knownArtifacts: ManagedIntegrationArtifacts[]
): Promise<ManagedIntegrationPlan> {
  const current = await readOptionalFile(path);
  if (current === artifacts.openCodePlugin) {
    return { current, key: "openCode", next: current, path, result: "reused" };
  }
  if (isKnownOpenCodePlugin(current, knownArtifacts)) {
    return {
      current,
      key: "openCode",
      next: artifacts.openCodePlugin,
      path,
      result: "changed",
    };
  }
  if (current !== null) {
    throw new Error(
      `OpenCode plugin path is already owned by another file: ${path}`
    );
  }
  return {
    current,
    key: "openCode",
    next: artifacts.openCodePlugin,
    path,
    result: "changed",
  };
}

async function planPluginUninstall(
  path: string,
  knownArtifacts: ManagedIntegrationArtifacts[]
): Promise<ManagedIntegrationPlan> {
  const current = await readOptionalFile(path);
  if (current === null) {
    return { current, key: "openCode", next: null, path, result: "missing" };
  }
  if (!isKnownOpenCodePlugin(current, knownArtifacts)) {
    throw new Error(`OpenMeld-owned OpenCode plugin was modified: ${path}`);
  }
  return { current, key: "openCode", next: null, path, result: "changed" };
}

function isKnownOpenCodePlugin(
  value: string | null,
  knownArtifacts: ManagedIntegrationArtifacts[]
): boolean {
  return knownArtifacts.some((artifacts) =>
    [
      artifacts.openCodePlugin,
      artifacts.legacyOpenCodePlugin,
      artifacts.preSessionIdFallbackOpenCodePlugin,
      artifacts.preSessionIdFallbackLegacyOpenCodePlugin,
      artifacts.preDirectoryFallbackOpenCodePlugin,
      artifacts.preDirectoryFallbackLegacyOpenCodePlugin,
    ].includes(value ?? "")
  );
}

async function planTextUpdate(
  path: string,
  key: "claude" | "codex" | "cursor",
  transform: (raw: string) => string
): Promise<ManagedIntegrationPlan> {
  const actualCurrent = await readOptionalFile(path);
  const current = actualCurrent ?? emptyFileFor(path);
  const next = transform(current);
  if (next === current) {
    return {
      current: actualCurrent,
      key,
      next: actualCurrent,
      path,
      result: "reused",
    };
  }
  return { current: actualCurrent, key, next, path, result: "changed" };
}

async function applyManagedIntegrationTransaction(input: {
  afterReplace?: (path: string) => Promise<void> | void;
  beforeCommit?: (path: string) => Promise<void> | void;
  plans: ManagedIntegrationPlan[];
}) {
  const changed = input.plans.filter((plan) => plan.result === "changed");
  for (const plan of changed) {
    await input.beforeCommit?.(plan.path);
  }
  for (const plan of changed) {
    if ((await readOptionalFile(plan.path)) !== plan.current) {
      throw revisionConflict(plan.path);
    }
  }
  const attempted: ManagedIntegrationPlan[] = [];
  try {
    for (const plan of changed) {
      attempted.push(plan);
      await commitManagedPlan(plan, input.afterReplace);
    }
  } catch (error) {
    const rollbackErrors: unknown[] = [];
    for (const plan of attempted.reverse()) {
      await restoreManagedPlan(plan).catch((rollbackError: unknown) => {
        rollbackErrors.push(rollbackError);
      });
    }
    if (rollbackErrors.length > 0) {
      throw new AggregateError(
        [error, ...rollbackErrors],
        "Managed integration update failed and rollback was incomplete."
      );
    }
    throw error;
  }
  return Object.fromEntries(
    input.plans.map((plan) => [plan.key, plan.result])
  ) as {
    claude: UpdateResult;
    codex: UpdateResult;
    cursor: UpdateResult;
    openCode: UpdateResult;
  };
}

async function commitManagedPlan(
  plan: ManagedIntegrationPlan,
  afterReplace?: (path: string) => Promise<void> | void
) {
  if ((await readOptionalFile(plan.path)) !== plan.current) {
    throw revisionConflict(plan.path);
  }
  await writeManagedValue(plan.path, plan.next, afterReplace);
}

async function restoreManagedPlan(plan: ManagedIntegrationPlan) {
  const current = await readOptionalFile(plan.path);
  if (current === plan.current) {
    return;
  }
  if (current !== plan.next) {
    throw new Error(`Managed integration rollback conflict: ${plan.path}`);
  }
  await writeManagedValue(plan.path, plan.current);
}

async function writeManagedValue(
  path: string,
  value: string | null,
  afterReplace?: (path: string) => Promise<void> | void
) {
  if (value === null) {
    await rm(path, { force: true });
    await afterReplace?.(path);
    return;
  }
  await mkdir(dirname(path), { mode: 0o700, recursive: true });
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, value, { encoding: "utf8", mode: 0o600 });
    await chmod(temporary, 0o600);
    await rename(temporary, path);
    await afterReplace?.(path);
    await chmod(path, 0o600);
  } finally {
    await rm(temporary, { force: true }).catch(() => undefined);
  }
}

async function readOptionalFile(path: string) {
  return await readFile(path, "utf8").catch((error: unknown) => {
    if (isNodeError(error, "ENOENT")) {
      return null;
    }
    throw error;
  });
}

function parseSettings(raw: string): Record<string, unknown> {
  return parseJsonObject(raw, "Claude settings");
}

function parseJsonObject(raw: string, label: string): Record<string, unknown> {
  if (!raw.trim()) {
    return {};
  }
  const value: unknown = JSON.parse(raw);
  if (!isRecord(value)) {
    throw new Error(`${label} must be a JSON object.`);
  }
  return value;
}

function ensureRecord(
  parent: Record<string, unknown>,
  key: string,
  label = "Claude settings"
) {
  if (parent[key] === undefined) {
    parent[key] = {};
  }
  if (!isRecord(parent[key])) {
    throw new Error(`${label} ${key} must be an object.`);
  }
  return parent[key];
}

function emptyFileFor(path: string) {
  return path.endsWith(".json") ? "{}\n" : "";
}

function revisionConflict(path: string) {
  const digest = createHash("sha256").update(path).digest("hex").slice(0, 12);
  return new Error(
    `Managed integration revision changed before commit (${digest}).`
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isNodeError(error: unknown, code: string) {
  return (
    error instanceof Error && "code" in error && String(error.code) === code
  );
}
