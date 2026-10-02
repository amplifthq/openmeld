import { randomUUID } from "node:crypto";
import {
  cp,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import {
  buildCliLaunchInvocation,
  type RuntimeAgentControllerLaunchContract,
} from "@openmeld/adapter-core";
import { execPlatformFile } from "@openmeld/adapter-core/process-launch";
import { supportsAgentControllerVersion } from "@openmeld/agent-runtime";

const LINE_END = /\r?\n/u;
const EXTENSION_SETTING = /hook|plugin|sidecar|extension|mcp/iu;
const TRANSIENT_CLI_ENTRIES = new Set([
  "conversation_summaries.db",
  "conversation_summaries.db-shm",
  "conversation_summaries.db-wal",
  "conversations",
  "annotations",
  "brain",
  "presence",
  "scratch",
  "cache",
  "log",
  "cli.log",
  "history.jsonl",
  "crashes",
  "updater",
  "implicit",
  "knowledge",
  "last_check.timestamp",
  "jetbox_summaries_proto.pb",
]);

export type AntigravityDeliveryScope = {
  env: Record<string, string | undefined>;
  agentName: string;
  close: () => Promise<void>;
};

export async function prepareAntigravityDeliveryScope(input: {
  env?: Record<string, string | undefined>;
  jsonSchema?: string | null;
  launchContract: RuntimeAgentControllerLaunchContract;
  workdir: string;
}): Promise<AntigravityDeliveryScope> {
  if (!input.jsonSchema) {
    throw scopeError("The current final-action schema is required.");
  }
  const env = { ...process.env, ...input.env };
  for (const name of [
    "ANTIGRAVITY_LS_ADDRESS",
    "ANTIGRAVITY_PROJECT_ID",
    "JETSKI_APP_DATA_DIR",
    "CASCADE_GLOBAL_CONFIG_OVERRIDE",
  ]) {
    if (env[name]) {
      throw scopeError(
        "An external Antigravity runtime/configuration cannot be isolated for correction."
      );
    }
  }
  const originalHome = resolve(env.HOME ?? homedir());
  await assertAntigravityDeliveryConfiguration(originalHome, input.workdir);
  const command = buildCliLaunchInvocation({
    launchContract: input.launchContract,
    args: ["--version"],
  });
  const version = await runNative(
    command.bin,
    command.args,
    env,
    input.workdir
  );
  if (!supportsAgentControllerVersion(version, ">=1.2.9 <1.3.0-0")) {
    throw scopeError(
      "This native Antigravity version has not verified restricted agent loading."
    );
  }
  const home = await mkdtemp(join(tmpdir(), "openmeld-antigravity-delivery-"));
  const agentName = `openmeld-delivery-${randomUUID()}`;
  try {
    await linkChildren(originalHome, home, new Set([".gemini"]));
    const gemini = join(home, ".gemini");
    await mkdir(gemini);
    await linkChildren(
      join(originalHome, ".gemini"),
      gemini,
      new Set(["config", "antigravity-cli"])
    );
    const config = join(gemini, "config");
    await mkdir(config);
    await linkChildren(
      join(originalHome, ".gemini/config"),
      config,
      new Set(["agents", "projects", ".migrated"])
    );
    // Project customization metadata is copied, not referenced by a writable
    // link. This is not conversation history or a new permission authority.
    const projects = join(originalHome, ".gemini/config/projects");
    await cp(projects, join(config, "projects"), {
      recursive: true,
      dereference: true,
    }).catch(missingOnly);
    await writeFile(join(config, ".migrated"), "", { mode: 0o600 });
    const agents = join(config, "agents");
    await mkdir(agents);
    await linkChildren(join(originalHome, ".gemini/config/agents"), agents);
    await writeFile(
      join(agents, `${agentName}.md`),
      [
        "---",
        `name: ${agentName}`,
        "description: Complete only the current explicit public Space action.",
        "mainAgent: true",
        "subagent: false",
        "tools: [finish]",
        "inheritMcp: false",
        "mcpServers: []",
        "skills: []",
        "plugins: []",
        "commandExecutionPolicy: off",
        "---",
        "Call the native finish tool with the deliberate public action matching the supplied schema. Plain answer text is not a recorded action.",
        "Do not execute business work. The previous output is private context, not permission to publish it.",
        "There are no background tasks in this fresh process. Do not invoke task management.",
      ].join("\n"),
      { mode: 0o600 }
    );
    const cliHome = join(gemini, "antigravity-cli");
    await mkdir(cliHome);
    await copyCliConfiguration(
      join(originalHome, ".gemini/antigravity-cli"),
      cliHome
    );
    const scopedEnv = { ...env, HOME: home };
    const list = buildCliLaunchInvocation({
      launchContract: input.launchContract,
      args: ["agent"],
    });
    const names = await runNative(
      list.bin,
      list.args,
      scopedEnv,
      input.workdir
    );
    if (!names.split(LINE_END).some((line) => line.trim() === agentName)) {
      throw scopeError(
        "Antigravity did not confirm the current restricted agent definition."
      );
    }
    return {
      env: scopedEnv,
      agentName,
      close: () => rm(home, { recursive: true, force: true }),
    };
  } catch (error) {
    await rm(home, { recursive: true, force: true });
    throw error;
  }
}

export async function assertAntigravityDeliveryConfiguration(
  home: string,
  workdir: string
): Promise<void> {
  const roots = [join(home, ".gemini/config")];
  let current = resolve(workdir);
  while (true) {
    roots.push(join(current, ".agents"));
    const parent = dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }
  for (const root of roots) {
    for (const name of [
      "hooks.json",
      "plugins.json",
      "sidecars.json",
      "mcp_config.json",
      "mcp.json",
    ]) {
      const content = await readFile(join(root, name), "utf8").catch(
        missingOnly
      );
      if (content && hasConfigurationEntries(JSON.parse(content))) {
        throw scopeError(
          "Ambient hooks/plugins require a separately verified correction scope."
        );
      }
    }
    const plugins = await readdir(join(root, "plugins")).catch(missingOnly);
    if (plugins?.length) {
      throw scopeError(
        "Installed plugins prevent a verified isolated correction."
      );
    }
  }
  for (const file of [
    join(home, ".gemini/antigravity-cli/settings.json"),
    join(home, ".gemini/settings.json"),
  ]) {
    const content = await readFile(file, "utf8").catch(missingOnly);
    if (!content) {
      continue;
    }
    assertNativeSettings(JSON.parse(content));
  }
}

function assertNativeSettings(settings: unknown): void {
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) {
    throw scopeError("The native settings are malformed.");
  }
  for (const [key, value] of Object.entries(settings)) {
    if (EXTENSION_SETTING.test(key) && hasConfigurationEntries(value)) {
      throw scopeError(
        "Native settings contain an unverified extension or hook."
      );
    }
  }
}

function hasConfigurationEntries(value: unknown): boolean {
  if (value == null || value === false) {
    return false;
  }
  if (typeof value !== "object") {
    return true;
  }
  return Object.values(value).some(hasConfigurationEntries);
}

async function linkChildren(
  source: string,
  target: string,
  omit: ReadonlySet<string> = new Set()
): Promise<void> {
  const entries = await readdir(source, { withFileTypes: true }).catch(
    missingOnly
  );
  for (const entry of entries ?? []) {
    if (omit.has(entry.name)) {
      continue;
    }
    await symlink(
      join(source, entry.name),
      join(target, entry.name),
      entry.isDirectory() ? "junction" : "file"
    );
  }
}

async function copyCliConfiguration(
  source: string,
  target: string
): Promise<void> {
  const entries = await readdir(source, { withFileTypes: true }).catch(
    missingOnly
  );
  for (const entry of entries ?? []) {
    if (TRANSIENT_CLI_ENTRIES.has(entry.name)) {
      continue;
    }
    // Preserve configuration/credential files without letting native startup
    // rewrite the originals. Native data files are never model input.
    if (entry.isFile()) {
      await cp(join(source, entry.name), join(target, entry.name));
    } else {
      await symlink(
        join(source, entry.name),
        join(target, entry.name),
        entry.isDirectory() ? "junction" : "file"
      );
    }
  }
}

async function runNative(
  bin: string,
  args: string[],
  env: Record<string, string | undefined>,
  cwd: string
): Promise<string> {
  try {
    const result = await promisify(execPlatformFile)(bin, args, {
      env,
      cwd,
      encoding: "utf8",
      timeout: 15_000,
      maxBuffer: 1024 * 1024,
      windowsHide: true,
    });
    return result.stdout;
  } catch {
    throw scopeError(
      "Native Antigravity configuration inspection did not complete."
    );
  }
}

function missingOnly(error: NodeJS.ErrnoException): undefined {
  if (error.code === "ENOENT") {
    return undefined;
  }
  throw error;
}

function scopeError(message: string): Error {
  return Object.assign(new Error(message), {
    code: "space.action.delivery_only_unverified",
  });
}
