import type {
  WorkspaceClient,
  WorkspaceRuntimeExecHandle,
} from "@cloudflare/computer";
import type { RemoteAgentStorage } from "../agent-core/callback-context";
import type { AgentComputerWorkspaceAccess } from "./agent-computer-workspace-access";
import { readCommandSlice } from "./computer-command";
import { AGENT_COMPUTER_CONTAINER_BACKEND_ID } from "./computer-workspace";
import type { GitWorkingCopyLocation } from "./github-working-copy-computer";

type Transfer = { id: string; operationId: string; attempt: number };
const PREFIX = "github-working-copy:git-transfer:";

/** A retained Computer process owns the pack transfer. Tool calls only start or poll it. */
export async function advanceGitPackTransfer(input: {
  storage: RemoteAgentStorage;
  workspaceAccess: AgentComputerWorkspaceAccess;
  operationId: string;
  packPath: string;
  location: GitWorkingCopyLocation;
  expiresAtMs: number;
}): Promise<"running" | "completed"> {
  const key = `${PREFIX}${input.operationId}`;
  const candidate: Transfer = {
    id: crypto.randomUUID(),
    operationId: input.operationId,
    attempt: 1,
  };
  const created = await input.storage.putIfAbsentExpiring(
    key,
    candidate,
    input.expiresAtMs
  );
  const transfer = created ? candidate : await input.storage.get<Transfer>(key);
  if (!transfer || transfer.operationId !== input.operationId) {
    throw new Error("github.checkout.git_transfer_state_unavailable");
  }
  return await input.workspaceAccess.withWorkspace(async (workspace) => {
    if (created) {
      await startGitPackTransfer(workspace, transfer, input);
      return "running";
    }
    const state = await pollGitPackTransfer(workspace, transfer);
    if (state !== "retry") {
      return state;
    }
    if (transfer.attempt >= 3) {
      throw new Error("github.checkout.git_transfer_failed_after_retries");
    }
    const retry: Transfer = {
      id: crypto.randomUUID(),
      operationId: transfer.operationId,
      attempt: transfer.attempt + 1,
    };
    if (
      await input.storage.compareAndSetExpiring(
        key,
        transfer,
        retry,
        input.expiresAtMs
      )
    ) {
      await startGitPackTransfer(workspace, retry, input);
    }
    return "running";
  });
}

async function startGitPackTransfer(
  workspace: WorkspaceClient,
  transfer: Transfer,
  input: Parameters<typeof gitPackTransferCommand>[0]
): Promise<void> {
  // Identity is persisted before dispatch. An uncertain spawn is inspected
  // on retry, never blindly started again against the same object store.
  const handle = await workspace.runtime.exec(gitPackTransferCommand(input), {
    id: transfer.id,
    backend: AGENT_COMPUTER_CONTAINER_BACKEND_ID,
    encoding: "utf8",
    timeoutMs: 30 * 60 * 1000,
  });
  handle[Symbol.dispose]();
}

async function pollGitPackTransfer(
  workspace: WorkspaceClient,
  transfer: Transfer
): Promise<"running" | "completed" | "retry"> {
  let handle: WorkspaceRuntimeExecHandle<"utf8">;
  try {
    handle = await workspace.runtime.getExec(transfer.id, {
      backend: AGENT_COMPUTER_CONTAINER_BACKEND_ID,
      encoding: "utf8",
    });
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      error.code === "EEXEC_BUSY"
    ) {
      return "running";
    }
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return "retry";
    }
    throw error;
  }
  const result = await readCommandSlice(handle, transfer.operationId, 0, 1000);
  if (result.status !== "completed") {
    return "running";
  }
  if (result.exitCode !== 0) {
    return "retry";
  }
  return "completed";
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
