import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

// CI-only native witness. All generated files remain in this isolated run's
// dev-tmp folder; it never invokes setup or touches a real installation.
if (process.platform !== "win32") {
  throw new Error("Run the background console witness on a Windows runner.");
}
const root = process.cwd();
const directory = resolve(root, "dev-tmp", "windows-background-console");
mkdirSync(directory, { recursive: true });
const source = join(directory, "console-probe.cs");
const command = join(directory, "console-probe.exe");
const parent = join(directory, "gui-parent.exe");
const evidence = join(directory, "evidence.json");
writeFileSync(
  source,
  `using System;
using System.Runtime.InteropServices;
class Probe {
  [DllImport("kernel32.dll")] static extern IntPtr GetConsoleWindow();
  static void Main() { Console.WriteLine(GetConsoleWindow() == IntPtr.Zero ? "no-console" : "console"); }
}
`
);
function run(binary, args) {
  const result = spawnSync(binary, args, {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
    timeout: 180_000,
  });
  if (result.error || result.status !== 0) {
    throw new Error(
      `${binary} failed: ${result.error?.message ?? result.stderr ?? result.status}`
    );
  }
}
run(
  join(
    process.env.WINDIR,
    "Microsoft.NET",
    "Framework64",
    "v4.0.30319",
    "csc.exe"
  ),
  ["/nologo", "/target:exe", `/out:${command}`, source]
);
run("bun", [
  "build",
  "--compile",
  "--target",
  "bun-windows-x64",
  "--windows-hide-console",
  "scripts/e2e/windows-background-console-entry.ts",
  "--outfile",
  parent,
]);
function subsystem(path) {
  const bytes = readFileSync(path);
  const peOffset = bytes.readUInt32LE(0x3c);
  return bytes.readUInt16LE(peOffset + 24 + 68);
}
if (subsystem(parent) !== 2) {
  throw new Error("witness parent must use the GUI subsystem");
}
if (subsystem(command) !== 3) {
  throw new Error("probe must use the console subsystem");
}
run(parent, [command, evidence]);
const observed = JSON.parse(readFileSync(evidence, "utf8"));
if (observed.positiveControl !== "console") {
  throw new Error("positive control did not allocate a console");
}
if (observed.actualGitVerifier !== "no-console") {
  throw new Error("Git verifier allocated a console");
}
process.stdout.write(`${JSON.stringify(observed)}\n`);

