import {
  type CloudComputerCommandReference,
  cloudComputerOperationResultSchema,
} from "@openmeld/schemas";
import type { RemoteAgentStorage } from "../agent-core/callback-context";
import type { AgentComputerWorkspaceAccess } from "./agent-computer-workspace-access";
import { AGENT_COMPUTER_CONTAINER_BACKEND_ID } from "./computer-workspace-config";
import type { GitWorkingCopyLocation } from "./github-working-copy-computer";

type Transfer = {
  operationId: string;
  invocationId: string;
  attempt: number;
  reference?: CloudComputerCommandReference;
};
const PREFIX = "github-working-copy:git-transfer:";

/** Keep only the original receipt address here. The Computer owns execution,
 * collection, Stop and idle eligibility, including between checkout polls. */
export async function advanceGitPackTransfer(input: {
  storage: RemoteAgentStorage;
  workspaceAccess: AgentComputerWorkspaceAccess;
  invocationId: string;
  operationId: string;
  packPath: string;
  location: GitWorkingCopyLocation;
  expiresAtMs: number;
}): Promise<"running" | "completed"> {
  const key = `${PREFIX}${input.operationId}`;
  const candidate: Transfer = {
    operationId: input.operationId,
    invocationId: input.invocationId,
    attempt: 1,
  };
  const created = await input.storage.putIfAbsentExpiring(
    key,
    candidate,
    input.expiresAtMs
  );
  let transfer = created ? candidate : await input.storage.get<Transfer>(key);
  if (!transfer || transfer.operationId !== input.operationId) {
    throw new Error("github.checkout.git_transfer_state_unavailable");
  }
  // Old detached imports have no receipt. Never silently launch a second import
  // or claim the old one completed. Deployment must settle those operations.
  if (!transfer.invocationId) {
    throw new Error("github.checkout.git_transfer_result_unconfirmed");
  }
  const operation = input.workspaceAccess.computerOperation;
  if (!operation) {
    throw new Error("computer.operations_unavailable");
  }
  const attempt = transfer.attempt;
  const commandKey = `git-import:${input.operationId}${attempt > 1 ? `:${attempt}` : ""}`;
  const result = readGitImportResult(
    await operation({
      action: "command",
      invocationId: transfer.invocationId,
      command:
        transfer.reference || transfer.invocationId !== input.invocationId
          ? {
              action: "poll",
              key: commandKey,
              reference: transfer.reference,
              waitSeconds: 0,
            }
          : {
              action: "start",
              key: commandKey,
              command: gitPackTransferCommand(input),
              backend: AGENT_COMPUTER_CONTAINER_BACKEND_ID,
              timeoutSeconds: 30 * 60,
            },
    })
  );
  if (result.reference && !transfer.reference) {
    const addressed = { ...transfer, reference: result.reference };
    if (
      await input.storage.compareAndSetExpiring(
        key,
        transfer,
        addressed,
        input.expiresAtMs
      )
    ) {
      transfer = addressed;
    }
  }
  if (result.status !== "completed") {
    return "running";
  }
  if (result.exitCode !== 0) {
    if (attempt < 3) {
      // Only a confirmed, synchronized process exit permits another attempt.
      // CAS makes concurrent checkout polls select one next receipt.
      if (
        await input.storage.compareAndSetExpiring(
          key,
          transfer,
          {
            operationId: input.operationId,
            invocationId: input.invocationId,
            attempt: attempt + 1,
          } satisfies Transfer,
          input.expiresAtMs
        )
      ) {
        // Admit the retry in this turn. A later turn can then poll its receipt
        // even when this response is lost, rather than finding an unstarted key.
        return await advanceGitPackTransfer(input);
      }
      return "running";
    }
    throw new Error("github.checkout.git_transfer_failed");
  }
  return "completed";
}

function readGitImportResult(value: unknown) {
  const result = cloudComputerOperationResultSchema.parse(value);
  if (Array.isArray(result) || !("status" in result)) {
    throw new Error("computer.invalid_command_result");
  }
  if (
    result.syncError ||
    result.nextAction === "inspect" ||
    (result.status === "completed" &&
      (typeof result.exitCode !== "number" || result.syncPending))
  ) {
    throw new Error(
      `github.checkout.git_transfer_result_unconfirmed: ${JSON.stringify({
        reference: result.reference,
        code: result.syncError,
      })}`
    );
  }
  return result;
}

function gitPackTransferCommand(input: {
  packPath: string;
  location: GitWorkingCopyLocation;
}): string {
  const request = {
    root: `${input.location.transportDirectory}/repository`,
    packPath: input.packPath,
    sourceCommit: input.location.sourceCommit,
    sourceTree: input.location.sourceTree,
    baselineCommit: input.location.baselineCommit,
    baselineTree: input.location.baselineTree,
  };
  return `python3 -c ${quote(GIT_PACK_TRANSFER_PROGRAM)} ${quote(JSON.stringify(request))}`;
}

function quote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

// Git protocol bytes arrived through the host. The Computer only validates and
// imports the pack; no URL, runtime bearer, or GitHub credential enters it.
export const GIT_PACK_TRANSFER_PROGRAM = `
import json, os, subprocess, sys
request = json.loads(sys.argv[1])
env = {k: v for k, v in os.environ.items() if not k.startswith('GIT_')}
env.update(GIT_CONFIG_NOSYSTEM='1', GIT_CONFIG_GLOBAL='/dev/null', GIT_TERMINAL_PROMPT='0', GIT_NO_REPLACE_OBJECTS='1')
root = request['root']
pack_path = request['packPath']
def git(*args):
    result = subprocess.run(['git', '-C', root, '-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false', '-c', 'credential.helper=', '-c', 'http.followRedirects=false', *args], env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if result.returncode: raise RuntimeError(result.stderr.decode('utf8', 'replace')[-800:])
    return result.stdout.decode('utf8', 'replace').strip()
try:
    git('cat-file', '-e', request['sourceCommit'] + '^{commit}')
    git('cat-file', '-e', request['baselineCommit'] + '^{commit}')
except RuntimeError:
    with open(pack_path, 'rb') as stream:
        imported = subprocess.run(['git', '-C', root, 'index-pack', '--stdin'], stdin=stream, env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        if imported.returncode: raise RuntimeError(imported.stderr.decode('utf8', 'replace')[-800:])
for name in ('source', 'baseline'):
    commit = request[name + 'Commit']
    if git('rev-parse', '--verify', commit + '^{commit}') != commit: raise RuntimeError('Fetched commit mismatch')
    if git('rev-parse', '--verify', commit + '^{tree}') != request[name + 'Tree']: raise RuntimeError('Fetched tree mismatch')
`;
