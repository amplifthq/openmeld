import { getWorkspace } from "@cloudflare/computer";
import { buildAgentComputerName } from "./computer-identity";
import {
  AGENT_COMPUTER_CONTAINER_BACKEND_ID,
  AGENT_COMPUTER_SHELL_BACKEND_ID,
  ensureAgentComputerLayout,
} from "./computer-workspace";

/**
 * Development-lane end-to-end exercise of the Center Agent's computer:
 * durable write, read-back, native grep, and a worker-shell exec that
 * observes the same file world. Never mounted in prod.
 */
export async function runAgentComputerSmoke(input: {
  agentProfileId: string;
  env: { AGENT_COMPUTER?: unknown };
  includeContainer?: boolean;
}): Promise<Record<string, unknown>> {
  const namespace = input.env.AGENT_COMPUTER as {
    idFromName(name: string): DurableObjectId;
    get(id: DurableObjectId): DurableObjectStub;
  };
  if (!namespace) {
    return { error: "AGENT_COMPUTER binding is not configured", ok: false };
  }
  const stub = namespace.get(
    namespace.idFromName(buildAgentComputerName(input.agentProfileId))
  );
  const workspace = await getWorkspace(
    stub as unknown as Parameters<typeof getWorkspace>[0]
  );
  const { workingDirectory } = await ensureAgentComputerLayout(workspace, {
    spaceId: "smoke-space",
  });

  const smokeFile = `${workingDirectory}/smoke.txt`;
  const stampedContent = `computer smoke ${input.agentProfileId}`;
  await workspace.fs.writeFile(smokeFile, `${stampedContent}\n`);
  const readBack = await workspace.fs.readFile(smokeFile, "utf8");
  const grepMatches = await workspace.fs.grep("computer smoke", smokeFile);

  const handle = await workspace.runtime.exec(`cat ${smokeFile}`, {
    backend: AGENT_COMPUTER_SHELL_BACKEND_ID,
    cwd: workingDirectory,
    encoding: "utf8",
    timeoutMs: 30_000,
  });
  const execResult = await handle.result();

  let container: Record<string, unknown> | null = null;
  if (input.includeContainer) {
    // Same file world through the second engine: python3 in the
    // computerd container must read the file the DO just wrote, and a
    // container-side write must be visible back on the durable fs.
    const containerHandle = await workspace.runtime.exec(
      `python3 -c "print(open('${smokeFile}').read().strip().upper())" && echo container-was-here > ${workingDirectory}/container-echo.txt`,
      {
        backend: AGENT_COMPUTER_CONTAINER_BACKEND_ID,
        cwd: workingDirectory,
        encoding: "utf8",
        timeoutMs: 180_000,
      }
    );
    const containerResult = await containerHandle.result();
    const containerEcho = await workspace.fs
      .readFile(`${workingDirectory}/container-echo.txt`, "utf8")
      .catch(() => null);
    container = {
      echoVisibleOnDurableFs: containerEcho === "container-was-here\n",
      exitCode: containerResult.exitCode,
      stderr: String(containerResult.stderr),
      stdout: String(containerResult.stdout),
    };
  }

  return {
    container,
    exec: {
      exitCode: execResult.exitCode,
      stderr: String(execResult.stderr),
      stdout: String(execResult.stdout),
    },
    grepMatchCount: grepMatches.length,
    ok:
      readBack === `${stampedContent}\n` &&
      grepMatches.length === 1 &&
      execResult.exitCode === 0 &&
      String(execResult.stdout).includes(stampedContent) &&
      (!input.includeContainer ||
        (container?.exitCode === 0 &&
          String(container?.stdout).includes(stampedContent.toUpperCase()) &&
          container?.echoVisibleOnDurableFs === true)),
    readBack,
    workingDirectory,
  };
}
