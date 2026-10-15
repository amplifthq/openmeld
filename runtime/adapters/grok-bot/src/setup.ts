import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  access,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  grokBotAccountSchema,
  grokBotStoredCredentialSchema,
} from "@openmeld/schemas";
import type { RuntimeAgentControllerLaunchCandidate } from "@openmeld/schemas/types";

const NODE_VERSION = "24.14.0";
const BDK_VERSION = "0.2.25";

export function grokBotSetupPaths(root: string) {
  const directory = join(root, "connection-tools", "grok-bot");
  const nodeDirectory = join(
    directory,
    `node-v${NODE_VERSION}-${process.platform}-${process.arch}`
  );
  return {
    directory,
    nodeDirectory,
    node: join(nodeDirectory, "bin", "node"),
    npm: join(nodeDirectory, "lib", "node_modules", "npm", "bin", "npm-cli.js"),
    script: join(
      directory,
      "bdk",
      "node_modules",
      "@cursor",
      "bdk",
      "dist",
      "bin",
      "agent-serve.js"
    ),
    config: join(directory, "auth"),
    launcher: join(directory, "launcher.mjs"),
  };
}

export function supportsGrokBotSetup() {
  return (
    ["darwin", "linux"].includes(process.platform) &&
    ["arm64", "x64"].includes(process.arch)
  );
}

function run(
  command: string,
  args: string[],
  options: { cwd: string; env?: NodeJS.ProcessEnv; timeout: number }
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
    });
    let output = "";
    let hardKill: ReturnType<typeof setTimeout> | undefined;
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      hardKill = setTimeout(() => child.kill("SIGKILL"), 5000);
    }, options.timeout);
    child.stdout.on("data", (chunk) => {
      output = (output + String(chunk)).slice(-16_384);
    });
    // Authentication output can contain login URLs or credentials. Never log it.
    child.stderr.resume();
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      clearTimeout(hardKill);
      if (code === 0) {
        resolve(output);
      } else {
        reject(
          new Error(
            "The connection tool did not finish successfully. Try again or open the setup guide."
          )
        );
      }
    });
  });
}

export async function readManagedGrokBotCandidate(
  root: string
): Promise<RuntimeAgentControllerLaunchCandidate | null> {
  const paths = grokBotSetupPaths(root);
  try {
    await access(paths.node);
    await access(paths.script);
    await access(paths.launcher);
  } catch {
    return null;
  }
  return {
    installId: "openmeld-managed-grok-bot",
    label: "OpenMeld connection tools",
    detail: `BDK ${BDK_VERSION} · managed by OpenMeld`,
    commandPath: paths.launcher,
    launchContract: {
      kind: "node_script",
      nodePath: paths.node,
      scriptPath: paths.launcher,
    },
  };
}

export async function installGrokBotTools(root: string) {
  if (!supportsGrokBotSetup()) {
    throw new Error("Install connection tools manually on this platform.");
  }
  const paths = grokBotSetupPaths(root);
  await mkdir(paths.directory, { recursive: true, mode: 0o700 });
  const archive = `node-v${NODE_VERSION}-${process.platform}-${process.arch}.tar.gz`;
  try {
    await access(paths.node);
  } catch {
    const base = `https://nodejs.org/dist/v${NODE_VERSION}/`;
    const [checksumResponse, archiveResponse] = await Promise.all([
      fetch(`${base}SHASUMS256.txt`, { signal: AbortSignal.timeout(60_000) }),
      fetch(`${base}${archive}`, { signal: AbortSignal.timeout(180_000) }),
    ]);
    if (!(checksumResponse.ok && archiveResponse.ok)) {
      throw new Error(
        "Could not download the connection runtime. Check the connection and retry."
      );
    }
    const expected = (await checksumResponse.text())
      .split("\n")
      .find((line) => line.endsWith(`  ${archive}`))
      ?.split(" ")[0];
    const bytes = Buffer.from(await archiveResponse.arrayBuffer());
    if (
      !expected ||
      createHash("sha256").update(bytes).digest("hex") !== expected
    ) {
      throw new Error("Connection runtime verification failed.");
    }
    const temporary = join(paths.directory, "download");
    await mkdir(temporary, { recursive: true, mode: 0o700 });
    await writeFile(join(temporary, archive), bytes, { mode: 0o600 });
    await run("tar", ["-xzf", join(temporary, archive), "-C", temporary], {
      cwd: temporary,
      timeout: 60_000,
    });
    await rename(
      join(temporary, archive.replace(".tar.gz", "")),
      paths.nodeDirectory
    );
    await rm(temporary, { recursive: true, force: true });
  }
  const bdk = join(paths.directory, "bdk");
  await mkdir(bdk, { recursive: true, mode: 0o700 });
  await run(
    paths.node,
    [
      paths.npm,
      "install",
      "--prefix",
      bdk,
      "--no-audit",
      "--no-fund",
      "--ignore-scripts",
      "--registry=https://registry.npmjs.org",
      `@cursor/bdk@${BDK_VERSION}`,
    ],
    {
      cwd: paths.directory,
      env: {
        ...process.env,
        PATH: `${join(paths.nodeDirectory, "bin")}:${process.env.PATH ?? ""}`,
      },
      timeout: 300_000,
    }
  );
  await run(paths.node, [paths.script, "--version"], {
    cwd: paths.directory,
    timeout: 15_000,
  });
  await writeFile(
    paths.launcher,
    `import { fileURLToPath } from 'node:url';\nprocess.env.AGENT_SERVE_CONFIG_DIR = fileURLToPath(new URL('./auth', import.meta.url));\nfor (const key of ['CURSOR_API_KEY','CURSOR_API_KEY_FILE','CURSOR_SERVICE_ACCOUNT_KEY','CURSOR_API_BASE_URL','CURSOR_WEBSITE_URL']) delete process.env[key];\nawait import('./bdk/node_modules/@cursor/bdk/dist/bin/agent-serve.js');\n`,
    { mode: 0o600 }
  );
}

export function managedGrokBotEnvironment(root: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    AGENT_SERVE_CONFIG_DIR: grokBotSetupPaths(root).config,
  };
  // The managed sign-in must not be masked by unrelated service credentials.
  for (const key of [
    "CURSOR_API_KEY",
    "CURSOR_API_KEY_FILE",
    "CURSOR_SERVICE_ACCOUNT_KEY",
    "CURSOR_API_BASE_URL",
    "CURSOR_WEBSITE_URL",
  ]) {
    delete env[key];
  }
  return env;
}

export async function isManagedGrokBotSignedIn(root: string): Promise<boolean> {
  const paths = grokBotSetupPaths(root);
  try {
    await access(join(paths.config, "credentials.json"));
    const output = await run(paths.node, [paths.script, "whoami", "--json"], {
      cwd: paths.directory,
      env: managedGrokBotEnvironment(root),
      timeout: 15_000,
    });
    return grokBotAccountSchema.safeParse(JSON.parse(output)).success;
  } catch {
    return false;
  }
}

export async function loginManagedGrokBot(root: string) {
  const paths = grokBotSetupPaths(root);
  await mkdir(paths.config, { recursive: true, mode: 0o700 });
  await run(
    paths.node,
    [paths.script, "login", "--key-name", "OpenMeld Grok Bot"],
    {
      cwd: paths.directory,
      env: managedGrokBotEnvironment(root),
      timeout: 600_000,
    }
  );
  if (!(await isManagedGrokBotSignedIn(root))) {
    throw new Error("Sign-in could not be verified. Sign in again.");
  }
}

export async function readManagedGrokBotCredential(
  launcher: string
): Promise<string> {
  try {
    const data = grokBotStoredCredentialSchema.parse(
      JSON.parse(
        await readFile(
          join(dirname(launcher), "auth", "credentials.json"),
          "utf8"
        )
      )
    );
    return data.apiKey;
  } catch {
    throw new Error("Could not read the managed Grok Bot sign-in.");
  }
}
