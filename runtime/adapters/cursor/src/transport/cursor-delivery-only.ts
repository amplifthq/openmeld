import { constants } from "node:fs";
import {
  access,
  cp,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import {
  type AdapterDispatchSpaceTools,
  buildCliLaunchInvocation,
  OPENMELD_SPACE_ACTION_MCP_SERVER_ID,
  type RuntimeAgentControllerLaunchContract,
  resolveDispatchSpaceActionMcpServer,
} from "@openmeld/adapter-core";
import { execPlatformFile } from "@openmeld/adapter-core/process-launch";

const DELIVERY_TOOLS = ["read_receipt", "reply", "stay_silent"];
// Native preToolUse + beforeMCPExecution, including failClosed, were exercised
// through ACP on this executable. Do not infer enforcement from CLI flags alone.
const VERIFIED_VERSION = "2026.09.18-9a7762b";
const EXTENSION_SETTING = /hook|plugin|mcpServers/iu;
const TRANSIENT_ENTRIES = new Set([
  "projects",
  "worktrees",
  "logs",
  "cache",
  "Cache",
  "hooks.json",
]);

export type CursorDeliveryScope = {
  env: Record<string, string | undefined>;
  activate: (sessionId: string) => Promise<void>;
  deactivate: () => Promise<void>;
  close: () => Promise<void>;
};

export async function prepareCursorDeliveryScope(input: {
  env?: Record<string, string | undefined>;
  spaceActionTools?: AdapterDispatchSpaceTools;
  launchContract: RuntimeAgentControllerLaunchContract;
  workdir: string;
}): Promise<CursorDeliveryScope> {
  if (
    !(
      input.spaceActionTools?.deliveryOnly &&
      resolveDispatchSpaceActionMcpServer(input.env)
    ) ||
    JSON.stringify(
      input.spaceActionTools.tools.map((tool) => tool.name).sort()
    ) !== JSON.stringify(DELIVERY_TOOLS)
  ) {
    throw cursorDeliveryScopeError(
      "The current Wake's delivery-only catalog is required."
    );
  }
  const env = { ...process.env, ...input.env };
  const sourceHome = resolve(env.HOME ?? env.USERPROFILE ?? homedir());
  const sourceConfig = resolve(
    env.CURSOR_CONFIG_DIR ??
      (env.XDG_CONFIG_HOME
        ? join(env.XDG_CONFIG_HOME, "cursor")
        : join(sourceHome, ".cursor"))
  );
  await assertCursorDeliveryConfiguration({
    home: sourceHome,
    config: sourceConfig,
    workdir: input.workdir,
  });
  const launch = buildCliLaunchInvocation({
    launchContract: input.launchContract,
    args: ["--disable-auto-update", "--version"],
  });
  const version = await readCursorDeliveryVersion(launch, env);
  if (version.trim() !== VERIFIED_VERSION) {
    throw cursorDeliveryScopeError(
      "This Cursor executable has not verified native delivery hooks."
    );
  }
  const hookRuntime = await resolveHookRuntime(
    input.launchContract,
    launch.bin
  );
  await access(hookRuntime, constants.X_OK).catch(() => {
    throw cursorDeliveryScopeError(
      "A verified native JavaScript runtime is required for delivery hooks."
    );
  });
  const home = await mkdtemp(join(tmpdir(), "openmeld-cursor-delivery-"));
  const cursor = join(home, ".cursor");
  const activePath = join(home, "active-delivery.json");
  const hookPath = join(home, "delivery-hook.mjs");
  try {
    // Preserve other native policy/credential sources at their original bytes.
    // Cursor's mutable global config, hooks and conversation data are isolated.
    for (const entry of await readdir(sourceHome, { withFileTypes: true })) {
      if (entry.name !== ".cursor") {
        await symlink(
          join(sourceHome, entry.name),
          join(home, entry.name),
          entry.isDirectory() ? "junction" : "file"
        );
      }
    }
    await mkdir(cursor, { mode: 0o700 });
    await copyCursorConfiguration(join(sourceHome, ".cursor"), cursor);
    const config =
      sourceConfig === join(sourceHome, ".cursor")
        ? cursor
        : join(home, "native-config");
    if (config !== cursor) {
      await mkdir(config, { mode: 0o700 });
      await copyCursorConfiguration(sourceConfig, config);
    }
    const hookSource = buildCursorDeliveryHookSource(activePath);
    await writeFile(hookPath, hookSource, { mode: 0o600 });
    const quote = (value: string) =>
      process.platform === "win32"
        ? `'${value.replaceAll("'", "''")}'`
        : `'${value.replaceAll("'", "'\\''")}'`;
    const command = `${process.platform === "win32" ? "& " : ""}${quote(hookRuntime)} ${quote(hookPath)}`;
    const hooks = Object.fromEntries(
      ["preToolUse", "beforeMCPExecution"].map((step) => [
        step,
        [{ command, failClosed: true }],
      ])
    );
    await writeFile(
      join(cursor, "hooks.json"),
      JSON.stringify({ version: 1, hooks }),
      { mode: 0o600 }
    );
    return {
      env: {
        ...env,
        HOME: home,
        USERPROFILE: home,
        CURSOR_CONFIG_DIR: config,
        CURSOR_DATA_DIR: cursor,
      },
      activate: async (sessionId) => {
        if (!sessionId) {
          throw cursorDeliveryScopeError(
            "A native correction session is required."
          );
        }
        await writeFile(activePath, JSON.stringify({ sessionId }), {
          mode: 0o600,
        });
      },
      deactivate: () => rm(activePath, { force: true }),
      close: () => rm(home, { recursive: true, force: true }),
    };
  } catch (error) {
    await rm(home, { recursive: true, force: true });
    throw error;
  }
}

/** A veto only: passing a hook never grants native tool permission. */
export function buildCursorDeliveryHookSource(activePath: string): string {
  return `import { readFile } from 'node:fs/promises';
let allowed = false;
try {
  let text = '';
  for await (const chunk of process.stdin) {
    text += chunk;
    if (Buffer.byteLength(text) > 1048576) throw new Error('Oversized hook input');
  }
  const input = JSON.parse(text);
  const active = JSON.parse(await readFile(${JSON.stringify(activePath)}, 'utf8'));
  const tools = ${JSON.stringify(DELIVERY_TOOLS)};
  const sameSession = input.session_id === active.sessionId && input.conversation_id === active.sessionId;
  allowed = sameSession && (
    (input.hook_event_name === 'preToolUse' && tools.some(name => input.tool_name === 'MCP:' + name)) ||
    (input.hook_event_name === 'beforeMCPExecution' && input.mcp_server_name === ${JSON.stringify(OPENMELD_SPACE_ACTION_MCP_SERVER_ID)} && tools.includes(input.tool_name))
  );
} catch { /* Missing, malformed or expired invocation is not permission. */ }
console.log(JSON.stringify(allowed ? {} : {
  permission: 'deny',
  user_message: 'This correction can only submit the current Space outcome or read its receipt.',
  agent_message: 'The operation was not executed. Do not repeat business work or seek another transport.'
}));
if (!allowed) process.exitCode = 2;
`;
}

export async function assertCursorDeliveryConfiguration(input: {
  home: string;
  config: string;
  workdir: string;
}): Promise<void> {
  const roots = new Set([input.home, resolve(input.workdir)]);
  let directory = resolve(input.workdir);
  while (dirname(directory) !== directory) {
    directory = dirname(directory);
    roots.add(directory);
  }
  const cursorRoots = new Set([
    input.config,
    ...[...roots].map((root) => join(root, ".cursor")),
  ]);
  const files = new Set<string>();
  for (const root of cursorRoots) {
    for (const name of [
      "hooks.json",
      "mcp.json",
      "cli-config.json",
      "cli.json",
      "managed/active-team-hooks/hooks.json",
    ]) {
      files.add(join(root, name));
    }
    const plugins = await readdir(join(root, "plugins")).catch(missingOnly);
    if (plugins?.length) {
      throw cursorDeliveryScopeError(
        "Installed plugins require a separately verified correction scope."
      );
    }
  }
  for (const root of roots) {
    files.add(join(root, ".claude/settings.json"));
    files.add(join(root, ".claude/settings.local.json"));
  }
  const enterpriseHookPaths: Record<string, string> = {
    darwin: "/Library/Application Support/Cursor/hooks.json",
    win32: "C:\\ProgramData\\Cursor\\hooks.json",
  };
  files.add(enterpriseHookPaths[process.platform] ?? "/etc/cursor/hooks.json");
  for (const file of files) {
    const source = await readFile(file, "utf8").catch(missingOnly);
    if (!source) {
      continue;
    }
    assertNoAmbientExtensions(source);
  }
}

async function readCursorDeliveryVersion(
  launch: ReturnType<typeof buildCliLaunchInvocation>,
  env: Record<string, string | undefined>
): Promise<string> {
  // Even --version normalizes cli-config.json in the native executable.
  // Its discovery must not touch the user's actual configuration either.
  const home = await mkdtemp(join(tmpdir(), "openmeld-cursor-version-"));
  try {
    const { stdout } = await promisify(execPlatformFile)(
      launch.bin,
      launch.args,
      {
        cwd: home,
        env: {
          ...env,
          HOME: home,
          USERPROFILE: home,
          CURSOR_CONFIG_DIR: join(home, ".cursor"),
          CURSOR_DATA_DIR: join(home, ".cursor"),
        },
        encoding: "utf8",
        timeout: 15_000,
        maxBuffer: 16_384,
        windowsHide: true,
      }
    );
    return stdout;
  } catch {
    throw cursorDeliveryScopeError(
      "Cursor's native version could not be verified."
    );
  } finally {
    await rm(home, { recursive: true, force: true });
  }
}

async function resolveHookRuntime(
  contract: RuntimeAgentControllerLaunchContract,
  executable: string
): Promise<string> {
  if (contract.kind === "node_script") {
    return contract.nodePath;
  }
  if (process.release.name === "node" && !process.versions.bun) {
    return process.execPath;
  }
  return join(
    dirname(await realpath(executable)),
    process.platform === "win32" ? "node.exe" : "node"
  );
}

function assertNoAmbientExtensions(source: string): void {
  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch {
    throw cursorDeliveryScopeError("A native policy source is not valid JSON.");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw cursorDeliveryScopeError(
      "A native policy source cannot be verified."
    );
  }
  for (const [key, setting] of Object.entries(value)) {
    if (EXTENSION_SETTING.test(key) && hasEntries(setting)) {
      throw cursorDeliveryScopeError(
        "Ambient hooks, plugins or MCPs require a separately verified correction scope."
      );
    }
  }
}

async function copyCursorConfiguration(
  source: string,
  target: string
): Promise<void> {
  const entries =
    (await readdir(source, { withFileTypes: true }).catch(missingOnly)) ?? [];
  for (const entry of entries) {
    if (TRANSIENT_ENTRIES.has(entry.name)) {
      continue;
    }
    await cp(join(source, entry.name), join(target, entry.name), {
      recursive: true,
      dereference: true,
    });
  }
}

function hasEntries(value: unknown): boolean {
  if (value == null || value === false) {
    return false;
  }
  if (Array.isArray(value)) {
    return value.length > 0;
  }
  if (typeof value === "object") {
    return Object.values(value).some(hasEntries);
  }
  return Boolean(value);
}

function missingOnly(error: NodeJS.ErrnoException): undefined {
  if (error.code !== "ENOENT") {
    throw error;
  }
}

export function cursorDeliveryScopeError(
  reason: string
): Error & { code: string; errorType: string } {
  return Object.assign(
    new Error(
      `Cursor delivery correction is unavailable: ${reason} No correction prompt was submitted.`
    ),
    {
      code: "space.action.delivery_only_unsupported",
      errorType: "config",
    }
  );
}
