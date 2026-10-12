import { createHash } from "node:crypto";
import type { SyncProgress, Workspace } from "@cloudflare/computer";

const ROOT = "/computer/object-batch-check";
const COUNT = 256;
const CHUNK = 512 * 1024;
const LARGE = 20 * CHUNK;
type State = {
  phase: "seed" | "push" | "native" | "pull" | "verify";
  steps: number;
  progress: SyncProgress[];
  maxStepMs: number;
  batches: Array<{ direction: string; count: number; bytes: number }>;
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

// Each request performs one SDK step, against the real native transport.
// This supplements the large empty-directory recovery matrix with real bytes.
export async function runComputerObjectBatchStep(input: {
  owner: Workspace;
  storage: DurableObjectStorage;
  execNative: (source: string) => Promise<unknown>;
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
  } else if (state.phase === "push" || state.phase === "pull") {
    const iterator = owner[state.phase]("container")[Symbol.asyncIterator]();
    try {
      const step = await iterator.next();
      if (step.value) {
        state.progress.push(step.value);
      }
      if (step.done || step.value?.complete) {
        state.phase = state.phase === "push" ? "native" : "verify";
      }
    } finally {
      await iterator.return?.();
    }
  } else if (state.phase === "native") {
    const source = `import pathlib,json,hashlib
p=pathlib.Path("${ROOT}")
for i in range(${COUNT}):
 assert (p/f"small-{i}").read_text()==(f"source-{i}:"*100)
assert hashlib.sha256((p/"large").read_bytes()).hexdigest()=="${digest(largeBytes(0))}"
for i in range(${COUNT}):
 (p/f"small-{i}").write_text(f"native-{i}:"*100)
(p/"large").write_bytes(b"".join(bytes([40+i])*${CHUNK} for i in range(20)))
print(json.dumps({"verified":${COUNT},"largeBytes":${LARGE}}))`;
    await input.execNative(`python3 -c '${source}'`);
    state.phase = "pull";
  } else {
    await verifyNativeBytes(owner, state);
    return Response.json({
      ...state,
      maxStepMs: Math.max(state.maxStepMs, Date.now() - startedAt),
      done: true,
      smallFiles: COUNT,
      largeBytes: LARGE,
      bytesVerified: true,
      mount: await input.inspectMount(),
    });
  }
  state.maxStepMs = Math.max(state.maxStepMs, Date.now() - startedAt);
  state.batches.push(...input.batches.splice(0));
  await storage.put("object-batches", state);
  return Response.json({ ...state, done: false });
}
