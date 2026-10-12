import { createHash } from "node:crypto";
import type {
  BackendHandle,
  SyncProgress,
  Workspace,
  WorkspaceRuntimeResult,
} from "@cloudflare/computer";

const ROOT = "/computer/object-batch-check";
const COUNT = 256;
const CHUNK = 512 * 1024;
const LARGE = 20 * CHUNK;
const EXECUTION_ID = "object-batch-result-sync-continuity";
type State = {
  phase: "seed" | "push" | "native" | "pull" | "verify";
  steps: number;
  progress: SyncProgress[];
  maxStepMs: number;
  batches: Array<{ direction: string; count: number; bytes: number }>;
  nativeResult?: WorkspaceRuntimeResult<"utf8">;
  nativeLogMissing?: { name: string; code: "ENOENT"; message: string };
  resumeSteps: number;
  syncOutcome?: Awaited<ReturnType<Workspace["executionSync"]>>;
};

function largeBytes(offset: number) {
  const bytes = new Uint8Array(LARGE);
  for (let i = 0; i < 20; i++) {
    bytes.fill(offset + i, i * CHUNK, (i + 1) * CHUNK);
  }
  return bytes;
}

function digest(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function verifyNativeBytes(owner: Workspace, state: State) {
  for (let i = 0; i < COUNT; i++) {
    const actual = await owner.fs.readFile(`${ROOT}/small-${i}`, "utf8");
    if (actual !== `native-${i}:`.repeat(100)) {
      throw new Error(`Native small file ${i} differs`);
    }
  }
  const hash = createHash("sha256");
  const reader = (await owner.fs.readFile(`${ROOT}/large`)).getReader();
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) {
        break;
      }
      hash.update(part.value);
    }
  } finally {
    reader.releaseLock();
  }
  if (hash.digest("hex") !== digest(largeBytes(40))) {
    throw new Error("Native large file bytes differ");
  }
  for (const direction of ["push", "pull"]) {
    if (
      !(
        state.batches.some(
          (batch) => batch.direction === direction && batch.count >= 250
        ) &&
        state.batches.some(
          (batch) =>
            batch.direction === direction && batch.bytes > 7 * 1024 * 1024
        ) &&
        state.progress.some(
          (p) =>
            p.direction === direction &&
            p.entries === 0 &&
            p.phase === "transferring"
        )
      )
    ) {
      throw new Error(`${direction} did not exercise partial object staging`);
    }
  }
}

function verifyOriginalResult(result: WorkspaceRuntimeResult<"utf8">) {
  const output = JSON.parse(result.stdout);
  if (
    result.exitCode !== 17 ||
    result.stderr !== "" ||
    output.verified !== COUNT ||
    output.largeBytes !== LARGE ||
    result.sync.status !== "pending"
  ) {
    throw new Error(
      `Original native result differs: ${JSON.stringify(result)}`
    );
  }
}

async function runNativeCommand(owner: Workspace) {
  const source = `import pathlib,json,hashlib,sys
p=pathlib.Path("${ROOT}")
for i in range(${COUNT}):
 assert (p/f"small-{i}").read_text()==(f"source-{i}:"*100)
assert hashlib.sha256((p/"large").read_bytes()).hexdigest()=="${digest(largeBytes(0))}"
for i in range(${COUNT}):
 (p/f"small-{i}").write_text(f"native-{i}:"*100)
(p/"large").write_bytes(b"".join(bytes([40+i])*${CHUNK} for i in range(20)))
print(json.dumps({"verified":${COUNT},"largeBytes":${LARGE}}))
sys.exit(17)`;
  const handle = await owner.runtime.exec(`python3 -c '${source}'`, {
    id: EXECUTION_ID,
    backend: "container",
    encoding: "utf8",
    sync: "defer",
  });
  const result = await handle.result();
  verifyOriginalResult(result);
  return result;
}

async function expireNativeLog(shell: BackendHandle["rpc"]["shell"]) {
  // Delete only the isolated native log. The Workspace's execution sync owner
  // and the files must remain intact, as they do after native log retention ends.
  await shell.disposeExec({ id: EXECUTION_ID });
  let unexpected: Awaited<ReturnType<typeof shell.getExec>>;
  try {
    unexpected = await shell.getExec({ id: EXECUTION_ID });
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return {
        name: error.name,
        code: "ENOENT" as const,
        message: error.message,
      };
    }
    throw error;
  }
  await unexpected.events.cancel();
  throw new Error("Native execution log remains readable after disposal");
}

// Each request performs one SDK step, against the real native transport.
// This supplements the large empty-directory recovery matrix with real bytes.
export async function runComputerObjectBatchStep(input: {
  owner: Workspace;
  storage: DurableObjectStorage;
  nativeShell: () => BackendHandle["rpc"]["shell"];
  executionCount: (id: string) => number;
  inspectMount: () => Promise<unknown>;
  batches: State["batches"];
}): Promise<Response> {
  const { owner, storage } = input;
  const startedAt = Date.now();
  const state = (await storage.get<State>("object-batches")) ?? {
    phase: "seed",
    steps: 0,
    progress: [],
    maxStepMs: 0,
    batches: [],
    resumeSteps: 0,
  };
  await owner.ready("container");
  state.steps++;
  if (state.phase === "seed") {
    await owner.fs.mkdir(ROOT, { recursive: true });
    for (let i = 0; i < COUNT; i++) {
      await owner.fs.writeFile(
        `${ROOT}/small-${i}`,
        `source-${i}:`.repeat(100)
      );
    }
    await owner.fs.writeFile(`${ROOT}/large`, largeBytes(0));
    state.phase = "push";
  } else if (state.phase === "push") {
    const iterator = owner.push("container")[Symbol.asyncIterator]();
    try {
      const step = await iterator.next();
      if (step.value) {
        state.progress.push(step.value);
      }
      if (step.done || step.value?.complete) {
        state.phase = "native";
      }
    } finally {
      await iterator.return?.();
    }
  } else if (state.phase === "native") {
    state.nativeResult = await runNativeCommand(owner);
    await storage.put("object-batches", state);
    state.nativeLogMissing = await expireNativeLog(input.nativeShell());
    state.phase = "pull";
  } else if (state.phase === "pull") {
    const step = await owner.resumeExecutionSync(EXECUTION_ID, "container");
    state.resumeSteps++;
    if (step.status === "pending") {
      state.progress.push(step.progress);
    } else {
      state.syncOutcome = step.outcome;
      state.phase = "verify";
    }
  } else {
    await verifyNativeBytes(owner, state);
    const executionCount = input.executionCount(EXECUTION_ID);
    const savedOutcome = await owner.executionSync(EXECUTION_ID, "container");
    if (
      executionCount !== 1 ||
      !state.nativeLogMissing ||
      !state.nativeResult ||
      state.resumeSteps < 2 ||
      !state.syncOutcome ||
      state.syncOutcome.error ||
      state.syncOutcome.skipped.length !== 0 ||
      savedOutcome?.epoch !== state.syncOutcome.epoch ||
      savedOutcome?.rev !== state.syncOutcome.rev ||
      savedOutcome?.skipped.length !== 0 ||
      savedOutcome?.skippedTruncated !== false ||
      savedOutcome?.error
    ) {
      throw new Error(
        "Original result and resumed sync did not survive cold owners"
      );
    }
    verifyOriginalResult(state.nativeResult);
    return Response.json({
      ...state,
      maxStepMs: Math.max(state.maxStepMs, Date.now() - startedAt),
      done: true,
      smallFiles: COUNT,
      largeBytes: LARGE,
      bytesVerified: true,
      executionId: EXECUTION_ID,
      executionCount,
      originalResultVerified: true,
      mount: await input.inspectMount(),
    });
  }
  state.maxStepMs = Math.max(state.maxStepMs, Date.now() - startedAt);
  state.batches.push(...input.batches.splice(0));
  await storage.put("object-batches", state);
  return Response.json({ ...state, done: false });
}
