import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

/** Pilot RPC compatibility is content identity, not a promise of portable RPC IDs. */
export function desktopWebBuildIdentity(root) {
  const files = execFileSync(
    "git",
    [
      "ls-files",
      "--cached",
      "--others",
      "--exclude-standard",
      "-z",
      "clients/web",
      "packages",
      "pnpm-lock.yaml",
      "scripts/desktop",
    ],
    { cwd: root, encoding: "utf8" }
  )
    .split("\0")
    .filter((file) => file && !file.endsWith("routeTree.gen.ts"))
    .sort();
  const hash = createHash("sha256");
  for (const file of new Set(files)) {
    hash
      .update(file)
      .update("\0")
      .update(readFileSync(path.join(root, file)))
      .update("\0");
  }
  return hash.digest("hex");
}
