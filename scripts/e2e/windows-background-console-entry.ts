import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { createGitRepositoryVerifier } from "../../clients/openmeld-cli/src/local-service/projects/git-repository-verifier";

const [command, evidencePath] = process.argv.slice(2);
if (!command || !evidencePath || process.platform !== "win32") {
  throw new Error("Expected an isolated Windows console probe and evidence path");
}
// Positive control: this GUI parent must be capable of allocating a console.
const visible = await new Promise<string>((resolve, reject) => {
  execFile(command, [], { windowsHide: false, encoding: "utf8" },
    (error, stdout) => error ? reject(error) : resolve(stdout.trim()));
});
assert.equal(visible, "console", "positive control did not allocate a console");
const verifier = createGitRepositoryVerifier();
const hidden = await verifier.runForTest({ command, args: [] });
assert.equal(hidden.stdout.trim(), "no-console", "background Git allocated a console");
await writeFile(evidencePath, JSON.stringify({
  platform: process.platform,
  guiParent: true,
  positiveControl: visible,
  actualGitVerifier: hidden.stdout.trim(),
}, null, 2));
