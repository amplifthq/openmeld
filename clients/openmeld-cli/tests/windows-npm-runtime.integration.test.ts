import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it } from "vitest";
import { resolveCurrentNpmCommandSpec } from "../src/runtime/current-npm-global-install";
import { withTempHome } from "./helpers/fs";

it("uses npm's JavaScript entry with the selected Node on Windows, even when npm.cmd exists", async () => {
  await withTempHome(async (home) => {
    const nodeDirectory = join(home, "Node installation 中文");
    const npmEntry = join(
      nodeDirectory,
      "node_modules",
      "npm",
      "bin",
      "npm-cli.js"
    );
    await mkdir(join(nodeDirectory, "node_modules", "npm", "bin"), {
      recursive: true,
    });
    await writeFile(join(nodeDirectory, "npm.cmd"), "@echo off\r\n");
    await writeFile(npmEntry, "// npm entry fixture\n");
    const nodeExecutablePath = join(nodeDirectory, "node.exe");
    expect(
      await resolveCurrentNpmCommandSpec({
        nodeExecutablePath,
        platform: "win32",
      })
    ).toEqual({ command: nodeExecutablePath, argsPrefix: [npmEntry] });
  });
});
