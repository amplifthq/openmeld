import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type {
  AdapterComputerFileAccessBoundary,
  AdapterDispatchExecutionMode,
} from "@openmeld/adapter-core";
import {
  CODEX_FILE_ACCESS_PERMISSION_PROFILE,
  resolveCodexExecutionContextAccess,
} from "./codex-file-access-boundary.js";

// Exercise actual opens, not Unix mode bits or the native permission summary.
// Every path is a Service-created sentinel; no project file is used as a probe.
const PROBE_SCRIPT = `
outside_read=denied
outside_write=denied
inside_read=denied
inside_write=denied
if ( IFS= read -r line < "$1" ) 2>/dev/null; then outside_read=allowed; fi
if ( printf 'changed\\n' > "$1" ) 2>/dev/null; then outside_write=allowed; fi
if ( IFS= read -r line < "$2" ) 2>/dev/null; then inside_read=allowed; fi
if ( printf 'changed\\n' > "$2" ) 2>/dev/null; then inside_write=allowed; fi
printf '%s:%s:%s:%s' "$outside_read" "$outside_write" "$inside_read" "$inside_write"
`;

export async function verifyCodexWorkspaceAccess(input: {
  boundary: AdapterComputerFileAccessBoundary;
  executionMode?: AdapterDispatchExecutionMode;
  workingDirectory: string;
  execute: (params: {
    command: string[];
    cwd: string;
    permissionProfile: string;
    timeoutMs: number;
    outputBytesCap: number;
  }) => Promise<unknown>;
}): Promise<void> {
  if (!input.boundary.executionContextAccess) {
    return;
  }
  const boundaryRoot = input.boundary.folders[0];
  if (
    process.platform === "win32" ||
    input.boundary.folders.length !== 1 ||
    !boundaryRoot
  ) {
    throw new Error("execution_context.workspace_probe_unsupported");
  }
  const outsideDirectory = await mkdtemp(
    join(dirname(boundaryRoot), ".openmeld-access-probe-")
  );
  const outsidePath = join(outsideDirectory, "sentinel");
  const insidePath = join(
    input.workingDirectory,
    `.openmeld-access-probe-${randomUUID()}`
  );
  try {
    await writeFile(outsidePath, "unchanged\n", { flag: "wx", mode: 0o600 });
    await writeFile(insidePath, "unchanged\n", { flag: "wx", mode: 0o600 });
    const result = await input.execute({
      command: [
        "/bin/sh",
        "-c",
        PROBE_SCRIPT,
        "openmeld-probe",
        outsidePath,
        insidePath,
      ],
      cwd: input.workingDirectory,
      permissionProfile: CODEX_FILE_ACCESS_PERMISSION_PROFILE,
      timeoutMs: 5000,
      outputBytesCap: 1024,
    });
    const expected =
      resolveCodexExecutionContextAccess(
        input.boundary,
        input.executionMode
      ) === "workspace"
        ? "denied:denied:allowed:allowed"
        : "denied:denied:allowed:denied";
    if (
      !result ||
      typeof result !== "object" ||
      !("exitCode" in result) ||
      result.exitCode !== 0 ||
      !("stdout" in result) ||
      result.stdout !== expected ||
      (await readFile(outsidePath, "utf8")) !== "unchanged\n"
    ) {
      throw new Error("execution_context.workspace_access_unverified");
    }
  } finally {
    await rm(insidePath, { force: true });
    await rm(outsideDirectory, { recursive: true, force: true });
  }
}
