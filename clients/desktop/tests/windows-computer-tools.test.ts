import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ExecFileFn } from "../src/main/cli/driver";
import { installWindowsComputerTools } from "../src/main/cli/windows-computer-tools";

let root: string;
let prefix: string;
let entry: string;
let nodeVersion: string;
let installedVersion: string;
let installError: Error | null;
let node: string;
let npm: string;
const calls: {
  file: string;
  args: readonly string[];
  env: NodeJS.ProcessEnv | undefined;
}[] = [];

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "OpenMeld Windows tools 测试 "));
  prefix = join(root, "custom npm prefix outside PATH");
  entry = join(prefix, "node_modules", "openmeld", "dist", "openmeld.js");
  nodeVersion = "v24.14.0";
  installedVersion = "0.3.213";
  installError = null;
  calls.length = 0;
  node = join(root, "node.exe");
  npm = join(root, "npm.cmd");
  for (const path of [node, npm]) {
    await writeFile(path, "test-only executable fixture");
    await chmod(path, 0o700);
  }
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function writePackage(version: string) {
  const dir = join(prefix, "node_modules", "openmeld");
  await mkdir(join(dir, "dist"), { recursive: true });
  await writeFile(
    join(dir, "package.json"),
    JSON.stringify({
      name: "openmeld",
      version,
      bin: { openmeld: "dist/openmeld.js" },
    })
  );
  await writeFile(
    entry,
    "// no product process is executed in acquisition tests"
  );
}

const exec: ExecFileFn = (file, args, options, callback) => {
  calls.push({ file, args: [...args], env: options.env });
  const run = async () => {
    if (file === node && args.join(" ") === "--version") {
      return nodeVersion;
    }
    if (file === npm && args[0] === "view") {
      return JSON.stringify({
        version: "0.3.213",
        engines: { node: "20.x || >=22 <26" },
      });
    }
    if (file === npm && args[0] === "prefix") {
      return prefix;
    }
    if (file === npm && args[0] === "install") {
      if (installError) {
        throw installError;
      }
      await writePackage(installedVersion);
      return "";
    }
    if (file === entry && args.join(" ") === "--version") {
      return installedVersion;
    }
    throw new Error(`Unexpected command in fixture: ${file} ${args.join(" ")}`);
  };
  run().then(
    (stdout) => callback(null, stdout, ""),
    (error) => callback(error, "", "")
  );
};
const deps = () => ({
  exec,
  env: {
    PATH: root,
    OPENMELD_HOME: join(root, "service"),
    OPENMELD_ENV_PRESET: "dev-local",
  },
});

it("pins npm version/prefix and returns the verified JS entry even when the prefix is outside PATH", async () => {
  const phases: string[] = [];
  expect(
    await installWindowsComputerTools(deps(), {
      onStage: (stage) => phases.push(stage),
    })
  ).toBe(entry);
  expect(calls.map(({ args }) => args[0])).toEqual([
    "--version",
    "view",
    "prefix",
    "install",
    "--version",
  ]);
  expect(calls[3]?.args).toEqual([
    "install",
    "--global",
    "--prefix",
    prefix,
    "openmeld@0.3.213",
    "--registry=https://registry.npmjs.org",
    "--no-audit",
    "--no-fund",
  ]);
  expect(calls.at(-1)?.file).toBe(entry);
  expect(
    calls.every(({ env }) => env?.OPENMELD_HOME === deps().env.OPENMELD_HOME)
  ).toBe(true);
  expect(phases).toEqual(["installing", "verifying"]);
});

it.each([
  "0.3.213",
  "0.3.214",
  "0.4.0-beta.1",
])("does not downgrade or reinstall an existing %s CLI", async (version) => {
  await writePackage(version);
  expect(await installWindowsComputerTools(deps())).toBe(entry);
  expect(calls.some(({ args }) => args[0] === "install")).toBe(false);
});

it("requires a real external Node and npm instead of using Electron or a Mac artifact", async () => {
  await rm(node);
  await expect(installWindowsComputerTools(deps())).rejects.toThrow(
    "Install Node.js with npm"
  );
  expect(calls).toHaveLength(0);
});

it.each([
  "v18.20.0",
  "v21.0.0",
  "v26.0.0",
  "not-a-version",
])("rejects a Node runtime outside the published engine contract: %s", async (version) => {
  nodeVersion = version;
  await expect(installWindowsComputerTools(deps())).rejects.toThrow(
    "requires Node.js"
  );
  expect(calls.some(({ args }) => args[0] === "install")).toBe(false);
});

it("retains the previous CLI when package acquisition fails and never starts a Service", async () => {
  await writePackage("0.3.200");
  installError = new Error("npm package acquisition failed");
  await expect(installWindowsComputerTools(deps())).rejects.toThrow(
    "npm package acquisition failed"
  );
  const metadata = JSON.parse(
    await readFile(
      join(prefix, "node_modules", "openmeld", "package.json"),
      "utf8"
    )
  );
  expect(metadata.version).toBe("0.3.200");
  expect(
    calls.some(({ args }) => args.includes("setup") || args.includes("service"))
  ).toBe(false);
});

it("rejects a different installed version rather than reporting successful bootstrap", async () => {
  installedVersion = "0.3.201";
  await expect(installWindowsComputerTools(deps())).rejects.toThrow(
    "installation changed or did not complete"
  );
});

it("does not let a failed progress observer change the installation", async () => {
  const onStage = vi.fn(() => {
    throw new Error("observer unavailable");
  });
  expect(await installWindowsComputerTools(deps(), { onStage })).toBe(entry);
  expect(onStage).toHaveBeenCalledTimes(2);
});
