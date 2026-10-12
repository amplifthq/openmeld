import { DurableObject } from "cloudflare:workers";
import {
  type BackendHandle,
  type DurableObjectStorageLike,
  getWorkspace,
  type SyncProgress,
  Workspace,
  type WorkspaceBackend,
} from "@cloudflare/computer";
import {
  LegacyContainerBackend,
  withLegacyWorkspaceContainer,
} from "@cloudflare/computer/backends/container-legacy";
import { createComputerCommandTool } from "../../flue-adapter/computer-command";
import { ComputerCommandSqlStorage } from "../../flue-adapter/computer-command-storage";
import { AGENT_COMPUTER_CONTAINER_ENV } from "../../flue-adapter/computer-workspace-config";
import { runComputerObjectBatchStep } from "./computer-object-batches";

// biome-ignore lint/performance/noBarrelFile: The SDK requires this named Worker RPC entrypoint.
export { WorkspaceProxy } from "@cloudflare/computer";

type ProbeEnv = {
  PROBE: DurableObjectNamespace;
  FUSE_PROFILE?: string;
  STRESS?: string;
};
class ProbeBase extends DurableObject<ProbeEnv> {}
const ROOT = "/computer/openmeld-container-check";
type BoundedState = {
  phase: string;
  offset: number;
  steps: number;
  phases: Record<string, number>;
  maxStepMs: number;
  maxSyncStepMs: number;
  writes?: number;
  restarts?: number;
  nativeUnacknowledgedSurvived?: boolean;
};
const LEAVES = 20_200;
const NATIVE_SOURCE_INSPECTION =
  'python3 -c \'import pathlib,json,hashlib; s=json.loads(pathlib.Path("/usr/local/share/openmeld/computerd-source.json").read_text()); print(json.dumps({"source":s,"binarySha256":hashlib.sha256(pathlib.Path("/usr/local/bin/computerd").read_bytes()).hexdigest(),"mount":[x for x in pathlib.Path("/proc/mounts").read_text().splitlines() if " /computer " in x]}))\'';

function containerEnvironment(
  profile: string | undefined
): Record<string, string> {
  switch (profile) {
    case "default":
      return { MOUNT_POINT: "/computer" };
    case "ac-only":
      return { MOUNT_POINT: "/computer", COMPUTERD_FUSE_AC_ATTR_TIMEOUT: "0" };
    case "attr-ac":
      return {
        MOUNT_POINT: "/computer",
        COMPUTERD_FUSE_ATTR_TIMEOUT: "0",
        COMPUTERD_FUSE_AC_ATTR_TIMEOUT: "0",
      };
    default:
      return { ...AGENT_COMPUTER_CONTAINER_ENV };
  }
}

function check(value: unknown, message: string): asserts value {
  if (!value) {
    throw new Error(message);
  }
}

export class ComputerContainerProbe extends withLegacyWorkspaceContainer(
  ProbeBase
) {
  readonly records: Array<{
    generation: string;
    entryCount: number;
    applied: number;
    cursor: { rev: number; path: string | null };
    lost: boolean;
  }> = [];
  loseNextAcknowledgement = true;
  interruptedOwner = false;
  nativeHandle: BackendHandle | undefined;
  readonly containerEnv = containerEnvironment(this.env.FUSE_PROFILE);
  makeNative(containerEnv: Record<string, string>) {
    return new LegacyContainerBackend({
      container: () => this,
      workspace: { binding: "PROBE", id: this.ctx.id.toString() },
      containerEnv,
      egress: { mode: "direct" },
      id: "container",
    });
  }
  native = this.makeNative(this.containerEnv);
  readonly execIds: string[] = [];
  captureReplacement = false;
  readonly replacementPushes: unknown[] = [];
  loseEntriesAcknowledgement = false;
  entriesAcknowledgement: unknown;
  receiverPackWrites: unknown;
  sourceTime: number | undefined;
  checkingObjectBatches = false;
  readonly objectBatches: Array<{
    direction: string;
    count: number;
    bytes: number;
  }> = [];
  private measureObjectBatch(
    direction: string,
    stream: ReadableStream<{ hash: Uint8Array; bytes: Uint8Array }>
  ) {
    if (!this.checkingObjectBatches) {
      return stream;
    }
    const batch = { direction, count: 0, bytes: 0 };
    const batches = this.objectBatches;
    const pendingReader = Promise.resolve(stream).then((value) =>
      value.getReader()
    );
    return new ReadableStream<{ hash: Uint8Array; bytes: Uint8Array }>({
      async pull(controller) {
        const reader = await pendingReader;
        const part = await reader.read();
        if (part.done) {
          reader.releaseLock();
          batches.push(batch);
          controller.close();
          return;
        }
        batch.count++;
        batch.bytes += part.value.bytes.byteLength;
        check(
          batch.count <= 256 && batch.bytes <= 8 * 1024 * 1024,
          "Actual object stream exceeded its batch budget"
        );
        controller.enqueue(part.value);
      },
      async cancel(reason) {
        const reader = await pendingReader;
        await reader.cancel(reason);
        reader.releaseLock();
      },
    });
  }
  private async traceSync<T>(
    name: string,
    operation: () => Promise<T>
  ): Promise<T> {
    if (this.env.STRESS !== "true") {
      return operation();
    }
    console.info("stress_rpc_start", name);
    try {
      return await operation();
    } finally {
      console.info("stress_rpc_end", name);
    }
  }

  readonly transport: WorkspaceBackend = {
    id: "container",
    type: "actual-container-with-lost-ack",
    connect: async () => {
      if (this.interruptedOwner) {
        throw new Error("PROBE_OWNER_DISCARDED_AFTER_LOST_ACK");
      }
      const handle = await this.traceSync("connect", () =>
        this.native.connect()
      );
      this.nativeHandle = handle;
      const sync = handle.rpc.sync;
      return {
        ...handle,
        rpc: {
          shell: {
            exec: (input) => {
              if (input.id) {
                this.execIds.push(input.id);
              }
              return handle.rpc.shell.exec(input);
            },
            getExec: (input) => handle.rpc.shell.getExec(input),
            killExec: (input) => handle.rpc.shell.killExec(input),
            disposeExec: (input) => handle.rpc.shell.disposeExec(input),
          },
          sync: {
            retentionHead: (slot) => {
              check(
                sync.retentionHead,
                "Native retention protocol is required"
              );
              return sync.retentionHead(slot);
            },
            beginRetention: (scope, expected) => {
              check(
                sync.beginRetention,
                "Native retention protocol is required"
              );
              return sync.beginRetention(scope, expected);
            },
            prepareChanges: (input) => {
              return this.traceSync("prepareChanges", () => {
                check(
                  sync.prepareChanges,
                  "Native bounded planner is required"
                );
                return sync.prepareChanges(input);
              });
            },
            discardChanges: (generation, scope) => {
              return this.traceSync("discardChanges", () => {
                check(
                  sync.discardChanges,
                  "Native bounded cleanup is required"
                );
                return sync.discardChanges(generation, scope);
              });
            },
            watermarks: (input) =>
              this.traceSync("watermarks", () => sync.watermarks(input)),
            push: async (input) => {
              if (!this.captureReplacement) {
                const ack = await this.traceSync("push", () =>
                  sync.push(input)
                );
                const injection =
                  await this.ctx.storage.get<string>("bounded-inject");
                if (injection && input.senderCursor?.path) {
                  await this.ctx.storage.delete("bounded-inject");
                  await this.ctx.storage.put(`bounded-lost:${injection}`, true);
                  throw new Error("BOUNDED_ACK_LOST_AFTER_APPLY");
                }
                if (this.loseEntriesAcknowledgement) {
                  this.loseEntriesAcknowledgement = false;
                  this.entriesAcknowledgement = ack;
                  await this.execNative(
                    `python3 -c 'import pathlib,json; p=pathlib.Path("${ROOT}"); (p/"replay-deleted.txt").write_text("receiver recreation"); (p/"replay-modified.txt").write_text("receiver modification"); print(json.dumps({"written":True}))'`
                  );
                  throw new Error(
                    "PROBE_ENTRIES_ACK_LOST_AFTER_RECEIVER_WRITES"
                  );
                }
                return ack;
              }
              const source = `${ROOT}/replacement-source.txt`;
              const target = `${ROOT}/matrix-value.txt`;
              const before = {
                source: await sync.readEntry(source),
                target: await sync.readEntry(target),
                watermarks: await sync.watermarks(),
              };
              const entries: unknown[] = [];
              const ack = await sync.push({
                ...input,
                changes: input.changes.pipeThrough(
                  new TransformStream({
                    transform(entry, controller) {
                      entries.push(entry);
                      controller.enqueue(entry);
                    },
                  })
                ),
              });
              this.replacementPushes.push({
                senderRev: input.senderRev,
                senderCursor: input.senderCursor,
                before,
                entries,
                ack,
                after: {
                  source: await sync.readEntry(source),
                  target: await sync.readEntry(target),
                  watermarks: await sync.watermarks(),
                },
              });
              return ack;
            },
            fetchChanges: (input) =>
              this.traceSync("fetchChanges", () => sync.fetchChanges(input)),
            readEntry: (path) => sync.readEntry(path),
            hasObjects: (hashes, scope) =>
              this.traceSync("hasObjects", () =>
                sync.hasObjects(hashes, scope)
              ),
            fetchObjects: (hashes, scope) =>
              this.measureObjectBatch("pull", sync.fetchObjects(hashes, scope)),
            pushObjects: (objects, scope) =>
              this.traceSync("pushObjects", () =>
                sync.pushObjects(
                  this.measureObjectBatch("push", objects),
                  scope
                )
              ),
            fetchChangePack: (input) => {
              check(
                sync.fetchChangePack,
                "The actual peer must support fetchChangePack"
              );
              return sync.fetchChangePack(input);
            },
            applyChangePack: async (input) => {
              check(
                sync.applyChangePack,
                "The actual peer must support applyChangePack"
              );
              // The real computerd decodes, commits and flushes the pack. Only
              // its already returned acknowledgement is lost at this boundary.
              const ack = await sync.applyChangePack(input);
              const lost = this.loseNextAcknowledgement;
              this.records.push({
                generation: input.generation,
                entryCount: ack.entryCount,
                applied: ack.applied,
                cursor: ack.appliedPushCursor,
                lost,
              });
              if (lost) {
                this.loseNextAcknowledgement = false;
                this.interruptedOwner = true;
                // Native writes happen after the peer commit. Replaying its
                // older pack must preserve both a recreation and a modification.
                this.receiverPackWrites = await this.execNative(
                  `python3 -c 'import pathlib,json; p=pathlib.Path("${ROOT}"); (p/"replay-deleted.txt").write_text("receiver recreation"); (p/"replay-modified.txt").write_text("receiver modification"); print(json.dumps({"deleted":(p/"replay-deleted.txt").read_text(),"modified":(p/"replay-modified.txt").read_text()}))'`
                );
                throw new Error("PROBE_ACK_LOST_AFTER_NATIVE_APPLY");
              }
              return ack;
            },
          },
        },
      };
    },
  };

  makeWorkspace() {
    return new Workspace({
      storage: this.ctx.storage as unknown as DurableObjectStorageLike,
      now: () => this.sourceTime ?? Date.now(),
      backends: [this.transport],
    });
  }

  async readNative() {
    const source = `python3 -c 'import pathlib,json; p=pathlib.Path("${ROOT}"); print(json.dumps({"leaves":len(list((p/"deep"/"same-rev").iterdir())),"content":(p/"native.txt").read_text(),"alias":(p/"alias.txt").read_text(),"symlink":(p/"symbolic.txt").read_text(),"moved":(p/"renamed"/"deep"/"file.txt").read_text(),"deleted":(p/"deleted.txt").exists()}))'`;
    return (await this.execNative(source)) as {
      leaves: number;
      content: string;
      alias: string;
      symlink: string;
      moved: string;
      deleted: boolean;
    };
  }

  async execNative(source: string, timeoutMs = 30_000) {
    check(this.nativeHandle, "Native transport must be connected");
    const handle = await this.nativeHandle.rpc.shell.exec({
      source,
      cwd: "/computer",
      timeoutMs,
    });
    const reader = handle.events.getReader();
    let stdout = "";
    let stderr = "";
    let exit: number | undefined;
    try {
      for (;;) {
        const event = await reader.read();
        if (event.done) {
          break;
        }
        if (event.value.name === "stdout") {
          stdout += new TextDecoder().decode(event.value.value);
        }
        if (event.value.name === "stderr") {
          stderr += new TextDecoder().decode(event.value.value);
        }
        if (event.value.name === "exit") {
          exit = event.value.code;
        }
      }
    } finally {
      reader.releaseLock();
    }
    check(
      exit === 0,
      `Native file verification failed: exit=${exit}, stderr=${stderr.slice(0, 1000)}`
    );
    return JSON.parse(stdout) as Record<string, unknown>;
  }

  async readNativeDatabase(path: string) {
    check(this.nativeHandle, "Native peer must be connected");
    const sync = this.nativeHandle.rpc.sync;
    check(
      sync.retentionHead && sync.beginRetention && sync.discardChanges,
      "Native retention is required"
    );
    const head = await sync.retentionHead("test-read");
    const scope = {
      epoch: head.epoch,
      slot: "test-read",
      generation: crypto.randomUUID(),
    };
    await sync.beginRetention(scope, head.generation);
    const entry = await this.nativeHandle.rpc.sync.readEntry(path);
    check(entry?.kind === "file", "Native metadata must contain this file");
    const stream = await this.nativeHandle.rpc.sync.fetchObjects(
      entry.chunks.map((chunk) => chunk.hash),
      scope
    );
    const reader = stream.getReader();
    const objects = new Map<string, Uint8Array>();
    try {
      for (;;) {
        const item = await reader.read();
        if (item.done) {
          break;
        }
        objects.set(Array.from(item.value.hash).join(","), item.value.bytes);
      }
    } finally {
      reader.releaseLock();
      check(
        await sync.discardChanges(scope.generation, scope),
        "Small read pins must retire in one page"
      );
    }
    return {
      rev: entry.rev,
      mtime: entry.mtime,
      size: entry.size,
      content: entry.chunks
        .map((chunk) =>
          new TextDecoder().decode(
            objects.get(Array.from(chunk.hash).join(","))
          )
        )
        .join(""),
    };
  }

  async inspectMount(owner: Workspace) {
    using execution = await owner.runtime.exec(
      'python3 -c \'import pathlib,json,hashlib; names=["COMPUTERD_FUSE_ATTR_TIMEOUT","COMPUTERD_FUSE_ENTRY_TIMEOUT","COMPUTERD_FUSE_AC_ATTR_TIMEOUT","COMPUTERD_FUSE_AUTO_CACHE"]; e=dict(x.split("=",1) for x in pathlib.Path("/proc/1/environ").read_bytes().decode().split("\\0") if "=" in x); s=json.loads(pathlib.Path("/usr/local/share/openmeld/computerd-source.json").read_text()); print(json.dumps({"env":{k:e.get(k) for k in names},"mount":[s for s in pathlib.Path("/proc/mounts").read_text().splitlines() if " /computer " in s],"source":s,"binarySha256":hashlib.sha256(pathlib.Path("/usr/local/bin/computerd").read_bytes()).hexdigest()}))\'',
      { backend: "container", encoding: "utf8", timeoutMs: 30_000 }
    );
    const result = await execution.result();
    check(
      result.exitCode === 0,
      `Native mount inspection failed: ${result.stderr}`
    );
    const mounted = JSON.parse(result.stdout) as {
      env: Record<string, string | null>;
      mount: string[];
      source: { sourcePatchSha256: string; binarySha256: string };
      binarySha256: string;
    };
    check(
      mounted.mount.some((row) => row.includes(" /computer fuse ")),
      `Real FUSE mount is required; observed=${JSON.stringify(mounted)}`
    );
    check(
      mounted.source.binarySha256 === mounted.binarySha256,
      "The running native image must contain its recorded compiled binary"
    );
    return mounted;
  }

  async runBoundedStep() {
    const state = (await this.ctx.storage.get<BoundedState>(
      "bounded-state"
    )) ?? {
      phase: "seed",
      offset: 0,
      steps: 0,
      phases: {},
      maxStepMs: 0,
      maxSyncStepMs: 0,
    };
    const isSyncStep = [
      "push",
      "restore",
      "restore-persisted",
      "delete-push",
      "pull",
      "churn-drain",
    ].includes(state.phase);
    const started = Date.now();
    if (this.env.STRESS === "true") {
      console.info("stress_step_start", state.steps, state.phase);
    }
    const owner = this.makeWorkspace();
    const tree = `${ROOT}/dependencies`;
    try {
      if (state.phase === "seed") {
        await owner.fs.mkdir(tree, { recursive: true });
        for (
          let i = state.offset;
          i < Math.min(state.offset + 128, LEAVES);
          i++
        ) {
          await owner.fs.writeFile(`${tree}/file-${i}`, "");
        }
        state.offset = Math.min(state.offset + 128, LEAVES);
        if (state.offset === LEAVES) {
          await owner.fs.writeFile(`${ROOT}/answer.txt`, "retained answer");
          await this.ctx.storage.put("bounded-inject", "initial");
          state.phase = "push";
        }
      } else {
        await owner.ready("container");
        if (isSyncStep) {
          await this.writeStressStep(owner, state);
          await this.transferBoundedStep(owner, state);
        } else {
          await this.advanceBoundedScenario(owner, state);
        }
      }
      state.steps++;
      if (isSyncStep) {
        state.maxSyncStepMs = Math.max(
          state.maxSyncStepMs,
          Date.now() - started
        );
      }
      state.maxStepMs = Math.max(state.maxStepMs, Date.now() - started);
      await this.ctx.storage.put("bounded-state", state);
      return Response.json({
        ...state,
        done: state.phase === "done",
        ...(state.phase === "done"
          ? await this.ctx.storage.get<Record<string, unknown>>(
              "bounded-report"
            )
          : {}),
      });
    } finally {
      if (this.env.STRESS === "true") {
        console.info("stress_step_close", state.steps, state.phase);
      }
      await owner.close();
      if (this.env.STRESS === "true") {
        console.info("stress_step_end", state.steps, state.phase);
      }
    }
  }

  private async writeStressStep(owner: Workspace, state: BoundedState) {
    if (
      this.env.STRESS !== "true" ||
      state.phase === "churn-drain" ||
      (state.writes ?? 0) >= 1024
    ) {
      return;
    }
    const i = state.writes ?? 0;
    const dir = `${ROOT}/churn`;
    await owner.fs.mkdir(dir, { recursive: true });
    await owner.fs.writeFile(`${dir}/${i}`, `${i}:`.padEnd(65_536, "x"));
    if (i > 0 && i % 3 === 0) {
      await owner.fs.rm(`${dir}/${i - 1}`);
    }
    state.writes = i + 1;
  }

  private async transferBoundedStep(owner: Workspace, state: BoundedState) {
    try {
      // Exactly one sync step per HTTP request. Closing this Workspace
      // discards all iterators, caches and handles before the next call.
      const step = await (state.phase === "pull"
        ? owner.pull("container")
        : owner.push("container"))
        [Symbol.asyncIterator]()
        .next();
      if (!step.done) {
        const phase = `${state.phase}:${step.value.phase ?? "transfer"}`;
        state.phases[phase] = (state.phases[phase] ?? 0) + 1;
      }
      if (step.done || step.value.complete) {
        const next: Record<string, string> = {
          push: "reset",
          restore: "native-write",
          "restore-persisted": "delete",
          pull: "delete",
          "delete-push": "verify",
          "churn-drain": "verify",
        };
        const nextPhase = next[state.phase];
        check(nextPhase, `Unexpected transfer phase: ${state.phase}`);
        const previousPhase = state.phase;
        state.phase = nextPhase;
        if (this.env.STRESS === "true") {
          if (state.phase === "native-write" && (state.restarts ?? 0) < 3) {
            state.phase = "reset";
          }
          if (nextPhase === "verify" && previousPhase !== "churn-drain") {
            state.phase = "churn-drain";
          }
        }
      }
    } catch (error) {
      if (!String(error).includes("BOUNDED_ACK_LOST_AFTER_APPLY")) {
        throw error;
      }
    }
  }

  private async observeUnsynchronizedFile(
    state: BoundedState,
    exists: unknown
  ) {
    if (this.env.STRESS !== "true") {
      return;
    }
    if (!state.restarts) {
      await this.execNative(
        `python3 -c 'import pathlib,json; pathlib.Path("${ROOT}/native-unacknowledged.txt").write_text("not yet synchronized"); print(json.dumps({"written":True}))'`
      );
    } else if (state.restarts === 1) {
      state.nativeUnacknowledgedSurvived = exists === true;
    }
  }

  private async advanceBoundedScenario(owner: Workspace, state: BoundedState) {
    const tree = `${ROOT}/dependencies`;
    if (state.phase === "reset") {
      const before = await this.execNative(
        `python3 -c 'import pathlib,json; p=pathlib.Path("${ROOT}"); files=list((p/"dependencies").iterdir()); assert {f.name for f in files}=={f"file-{i}" for i in range(${LEAVES})}; assert all(f.stat().st_size==0 for f in files); print(json.dumps({"files":len(files),"answer":(p/"answer.txt").read_text(),"unacknowledgedExists":(p/"native-unacknowledged.txt").exists()}))'`
      );
      check(
        before.files === LEAVES && before.answer === "retained answer",
        "Initial native files differ"
      );
      await owner.fs.writeFile(`${ROOT}/new.txt`, "new window");
      await owner.push("container")[Symbol.asyncIterator]().next();
      await this.observeUnsynchronizedFile(state, before.unacknowledgedExists);
      state.phase = "destroy";
    } else if (
      state.phase === "destroy" ||
      state.phase === "destroy-persisted"
    ) {
      check(this.ctx.container, "Native container required");
      await this.ctx.container.destroy();
      state.restarts = (state.restarts ?? 0) + 1;
      state.phase = state.phase === "destroy" ? "restore" : "restore-persisted";
    } else if (state.phase === "native-write") {
      const restored = await this.execNative(
        `python3 -c 'import pathlib,json; p=pathlib.Path("${ROOT}"); files=list((p/"dependencies").iterdir()); assert {f.name for f in files}=={f"file-{i}" for i in range(${LEAVES})}; assert all(f.stat().st_size==0 for f in files); print(json.dumps({"files":len(files),"answer":(p/"answer.txt").read_text(),"new":(p/"new.txt").read_text()}))'`
      );
      check(
        restored.files === LEAVES &&
          restored.answer === "retained answer" &&
          restored.new === "new window",
        "Reset failed to restore unchanged files"
      );
      await this.execNative(
        `python3 -c 'import pathlib,json; p=pathlib.Path("${ROOT}/native-output/deep"); p.mkdir(parents=True,exist_ok=True); [(p/str(i)).touch() for i in range(${LEAVES})]; (p/"answer.txt").write_text("native result"); print(json.dumps({"written":${LEAVES}}))'`,
        300_000
      );
      state.phase = "pull";
    } else if (state.phase === "delete") {
      const nativeNames = new Set(
        (await owner.fs.readdir(`${ROOT}/native-output/deep`)).map(
          (entry) => entry.name
        )
      );
      check(
        nativeNames.size === LEAVES + 1 && nativeNames.has("answer.txt"),
        "Native directory set differs"
      );
      for (let i = 0; i < LEAVES; i++) {
        check(nativeNames.has(String(i)), `Missing native file ${i}`);
      }
      check(
        (await owner.fs.readdir(`${ROOT}/native-output/deep`)).length ===
          LEAVES + 1,
        "Native producer lost directory entries"
      );
      check(
        (await owner.fs.readFile(
          `${ROOT}/native-output/deep/answer.txt`,
          "utf8"
        )) === "native result",
        "Native output bytes were not retained"
      );
      if (await this.checkNativeOutputRecovery(state)) {
        return;
      }
      await owner.fs.rm(tree, { recursive: true });
      await owner.fs.mkdir(tree, { recursive: true });
      await owner.fs.writeFile(`${tree}/answer.txt`, "recreated directory");
      await this.ctx.storage.put("bounded-inject", "delete");
      state.phase = "delete-push";
    } else if (state.phase === "verify") {
      if (this.env.STRESS === "true") {
        const count = state.writes ?? 0;
        check(count === 1024, "All 1024 writes must execute");
        const verified = await this.execNative(
          `python3 -c 'import pathlib,json; p=pathlib.Path("${ROOT}/churn"); n=${count}; expected={str(i) for i in range(n) if not (i+1<n and (i+1)%3==0)}; actual={x.name for x in p.iterdir()}; assert actual==expected,(len(actual),len(expected)); assert all((p/str(i)).read_text()==(str(i)+":").ljust(65536,"x") for i in range(n) if str(i) in expected); print(json.dumps({"verified":len(expected)}))'`
        );
        check(Number(verified.verified) > 0, "Churn verification missing");
        check(state.restarts === 4, "Four restarts required");
      }
      const files = await this.execNative(
        `python3 -c 'import pathlib,json; p=pathlib.Path("${ROOT}"); print(json.dumps({"files":[x.name for x in (p/"dependencies").iterdir()],"answer":(p/"answer.txt").read_text(),"recreated":(p/"dependencies"/"answer.txt").read_text()}))'`
      );
      check(
        JSON.stringify(files.files) === JSON.stringify(["answer.txt"]) &&
          files.answer === "retained answer" &&
          files.recreated === "recreated directory",
        "Delete/recreate lost files or retained stale files"
      );
      const mount = await this.execNative(NATIVE_SOURCE_INSPECTION);
      check(
        (mount.mount as string[]).some((row) =>
          row.includes(" /computer fuse ")
        ),
        "Real FUSE required"
      );
      state.phase = "done";
      await this.ctx.storage.put("bounded-report", {
        files,
        mount,
        leaves: LEAVES,
        lostInitial: await this.ctx.storage.get("bounded-lost:initial"),
        lostDelete: await this.ctx.storage.get("bounded-lost:delete"),
      });
    }
  }

  private async checkNativeOutputRecovery(state: BoundedState) {
    if (this.env.STRESS !== "true") {
      return false;
    }
    if (state.restarts === 3) {
      state.phase = "destroy-persisted";
      return true;
    }
    const recovered = await this.execNative(
      `python3 -c 'import pathlib,json; p=pathlib.Path("${ROOT}/native-output/deep"); expected={str(i) for i in range(${LEAVES})}|{"answer.txt"}; assert {x.name for x in p.iterdir()}==expected; assert all((p/str(i)).stat().st_size==0 for i in range(${LEAVES})); assert (p/"answer.txt").read_text()=="native result"; print(json.dumps({"verified":len(expected)}))'`
    );
    check(
      recovered.verified === LEAVES + 1,
      "Synchronized native output must survive container replacement"
    );
    return false;
  }

  private async warmContainer() {
    const owner = this.makeWorkspace();
    try {
      await owner.ready("container");
      return Response.json(
        await this.execNative(
          "python3 -c 'import json; print(json.dumps({\"warm\":True}))'"
        )
      );
    } finally {
      await owner.close();
    }
  }

  fetch(request: Request) {
    if (new URL(request.url).pathname === "/objects") {
      return this.runObjectBatchStep();
    }
    if (new URL(request.url).pathname === "/warm") {
      return this.warmContainer();
    }
    if (new URL(request.url).pathname === "/bounded") {
      return this.runBoundedStep();
    }
    if (new URL(request.url).pathname === "/api") {
      return this.native.handleFetch(request);
    }
    if (new URL(request.url).pathname === "/matrix") {
      return this.runCacheMatrix();
    }
    if (new URL(request.url).pathname === "/adoption") {
      return this.runAdoption();
    }
    return this.runPack();
  }

  private async runObjectBatchStep() {
    const owner = this.makeWorkspace();
    this.loseNextAcknowledgement = false;
    this.checkingObjectBatches = true;
    try {
      return await runComputerObjectBatchStep({
        owner,
        storage: this.ctx.storage,
        nativeShell: () => {
          check(this.nativeHandle, "Native transport must be connected");
          return this.nativeHandle.rpc.shell;
        },
        executionCount: (id) =>
          this.execIds.filter((executionId) => executionId === id).length,
        inspectMount: () => this.execNative(NATIVE_SOURCE_INSPECTION),
        batches: this.objectBatches,
      });
    } finally {
      await owner.close();
    }
  }

  private async runPack() {
    const workspace = this.makeWorkspace();
    let owner = workspace;
    try {
      await owner.ready();
      await owner.fs.mkdir(`${ROOT}/deep/same-rev`, { recursive: true });
      await owner.fs.writeFile(`${ROOT}/native.txt`, "before");
      await owner.fs.writeFile(`${ROOT}/deleted.txt`, "delete me");
      await owner.fs.writeFile(`${ROOT}/replay-deleted.txt`, "original");
      await owner.fs.writeFile(`${ROOT}/replay-modified.txt`, "original");
      await owner.fs.mkdir(`${ROOT}/move/deep`, { recursive: true });
      await owner.fs.writeFile(`${ROOT}/move/deep/file.txt`, "moved");
      await owner.fs.symlink(`${ROOT}/native.txt`, `${ROOT}/symbolic.txt`);
      const directory = await owner.fs.stat(`${ROOT}/deep/same-rev`);
      const aliasParent = await owner.fs.stat(ROOT);
      const file = await owner.fs.stat(`${ROOT}/native.txt`);
      const sql = this.ctx.storage.sql;
      // The public filesystem has no hardlink or shared-revision bulk API.
      // This disposable fixture uses the installed native VFS schema only.
      this.ctx.storage.transactionSync(() => {
        sql.exec("UPDATE vfs_meta SET v=v+1 WHERE k='rev'");
        sql.exec(
          "INSERT INTO vfs_dirents(parent_inode,name,child_inode) VALUES (?,'alias.txt',?)",
          aliasParent.inode,
          file.inode
        );
        sql.exec(
          "UPDATE vfs_nodes SET rev=(SELECT v FROM vfs_meta WHERE k='rev') WHERE inode=?",
          file.inode
        );
      });
      for await (const _ of owner.push("container")) {
        /* establish real baseline files */
      }
      await this.inspectMount(owner);
      console.info("[computer_container_check] baseline_applied");
      // Include these entries at the start of the lost pack, before the
      // same-revision directory fanout can fill its first block.
      await owner.fs.rm(`${ROOT}/replay-deleted.txt`);
      await owner.fs.writeFile(`${ROOT}/replay-modified.txt`, "sender change");
      const maxInode = sql
        .exec<{ inode: number }>("SELECT MAX(inode) AS inode FROM vfs_nodes")
        .one().inode;
      this.ctx.storage.transactionSync(() => {
        sql.exec("UPDATE vfs_meta SET v=v+1 WHERE k='rev'");
        sql.exec(
          "WITH RECURSIVE s(n) AS (VALUES(1) UNION ALL SELECT n+1 FROM s WHERE n<?) INSERT INTO vfs_nodes(inode,type,mode,mtime,rev) SELECT ?+n,'dir',493,0,(SELECT v FROM vfs_meta WHERE k='rev') FROM s",
          LEAVES,
          maxInode
        );
        sql.exec(
          "WITH RECURSIVE s(n) AS (VALUES(1) UNION ALL SELECT n+1 FROM s WHERE n<?) INSERT INTO vfs_dirents(parent_inode,name,child_inode) SELECT ?,'leaf-'||printf('%06d',n),?+n FROM s",
          LEAVES,
          directory.inode,
          maxInode
        );
      });
      await owner.fs.rename(`${ROOT}/move`, `${ROOT}/renamed`);
      await owner.fs.rm(`${ROOT}/deleted.txt`);
      const frozenTargetRev = sql
        .exec<{ v: number }>("SELECT v FROM vfs_meta WHERE k='rev'")
        .one().v;
      let rejected = false;
      let firstError = "";
      try {
        for await (const _ of owner.push("container")) {
          /* must reject on the first native pack */
        }
      } catch (error) {
        firstError = String(error);
        rejected = firstError.includes("PROBE_ACK_LOST_AFTER_NATIVE_APPLY");
      }
      check(
        rejected,
        `The first real native acknowledgement must be lost; observed=${firstError.slice(0, 1000)}`
      );
      check(
        this.records.length === 1 && this.records[0]?.lost,
        "The actual peer must apply exactly one pack before loss"
      );
      const lost = this.records[0];
      check(
        lost && lost.entryCount > 0 && lost.applied > 0,
        "Lost acknowledgement must follow actual changes"
      );
      console.info("[computer_container_check] native_ack_lost", {
        generation: lost.generation,
        entryCount: lost.entryCount,
        cursor: lost.cursor,
      });
      // A later write must not enter the retained operation's frozen target.
      await owner.fs.writeFile(`${ROOT}/native.txt`, "after");
      await owner.close();
      this.interruptedOwner = false;
      owner = this.makeWorkspace();
      await owner.ready();
      const resumed: SyncProgress[] = [];
      for await (const progress of owner.push("container")) {
        resumed.push(progress);
      }
      const replay = this.records[1];
      // The public adaptive protocol can shrink an interrupted block. Its
      // replay stays within that unacknowledged window, under the same target.
      check(
        replay &&
          replay.generation === lost.generation &&
          replay.entryCount <= lost.entryCount,
        "Retained generation must replay within the unacknowledged window"
      );
      check(
        replay.applied === 0,
        "Real receiver must absorb the already applied block"
      );
      check(
        resumed.every(
          (progress) =>
            progress.generation === lost.generation &&
            progress.targetCursor.rev === frozenTargetRev
        ),
        "Recreated sender must keep its frozen target and generation"
      );
      console.info("[computer_container_check] sender_recreated_and_drained", {
        blocks: resumed.length,
        replayApplied: replay.applied,
      });
      const frozen = await this.readNative();
      const receiverReplay = await this.execNative(
        `python3 -c 'import pathlib,json; p=pathlib.Path("${ROOT}"); print(json.dumps({"deleted":(p/"replay-deleted.txt").read_text(),"modified":(p/"replay-modified.txt").read_text()}))'`
      );
      check(
        receiverReplay.deleted === "receiver recreation" &&
          receiverReplay.modified === "receiver modification",
        "A lost pack replay must preserve newer native receiver writes"
      );
      check(
        frozen.leaves === LEAVES &&
          frozen.content === "before" &&
          frozen.alias === "before" &&
          frozen.symlink === "before" &&
          frozen.moved === "moved" &&
          !frozen.deleted,
        "Frozen pack must preserve all paths and exclude the later write"
      );
      const laterProgress: SyncProgress[] = [];
      for await (const progress of owner.push("container")) {
        laterProgress.push(progress);
      }
      const later = await this.readNative();
      console.info("[computer_container_check] later_write_observed", {
        later,
        laterProgress,
      });
      const nativeMetadata = {
        file: await this.readNativeDatabase(`${ROOT}/native.txt`),
        alias: await this.readNativeDatabase(`${ROOT}/alias.txt`),
      };
      console.info(
        "[computer_container_check] native_metadata_observed",
        nativeMetadata
      );
      check(
        later.content === "after" &&
          later.alias === "after" &&
          later.symlink === "after",
        `Later write must reach every alias; native=${JSON.stringify(later)}, metadata=${JSON.stringify(nativeMetadata)}`
      );
      console.info("[computer_container_check] later_write_confirmed");
      for await (const _ of owner.pull("container")) {
        /* Persist native receiver writes before intentionally destroying it. */
      }
      check(
        (await owner.fs.readFile(`${ROOT}/replay-deleted.txt`, {
          encoding: "utf8",
        })) === "receiver recreation" &&
          (await owner.fs.readFile(`${ROOT}/replay-modified.txt`, {
            encoding: "utf8",
          })) === "receiver modification",
        "Native receiver writes must reach canonical storage before reset"
      );
      check(this.nativeHandle, "Native transport must still be connected");
      const beforeReset = await this.nativeHandle.rpc.sync.watermarks();
      await owner.close();
      check(
        this.ctx.container,
        "The disposable receiver must have a native container"
      );
      await this.ctx.container.destroy();
      owner = this.makeWorkspace();
      await owner.ready("container");
      check(this.nativeHandle, "New receiver must be connected");
      const afterReset = await this.nativeHandle.rpc.sync.watermarks();
      check(
        beforeReset.fetchCursor.rev > 0 && afterReset.fetchCursor.rev === 0,
        "Actual receiver reset must clear its acknowledgement watermark"
      );
      console.info("[computer_container_check] receiver_reset_confirmed");
      const resetProgress: SyncProgress[] = [];
      for await (const progress of owner.push("container")) {
        resetProgress.push(progress);
      }
      const reset = await this.readNative();
      const resetReceiverWrites = await this.execNative(
        `python3 -c 'import pathlib,json; p=pathlib.Path("${ROOT}"); print(json.dumps({"deleted":(p/"replay-deleted.txt").read_text(),"modified":(p/"replay-modified.txt").read_text()}))'`
      );
      check(
        JSON.stringify(resetReceiverWrites) === JSON.stringify(receiverReplay),
        "Receiver reset must restore the synchronized receiver writes"
      );
      const mount = await this.inspectMount(owner);
      check(
        JSON.stringify(reset) === JSON.stringify(later),
        "Receiver reset must recover every file without discarding sender state"
      );
      return Response.json({
        leaves: LEAVES,
        records: this.records,
        receiverPackWrites: this.receiverPackWrites,
        receiverReplay,
        resetReceiverWrites,
        mount,
        resumed,
        frozen,
        later,
        beforeReset,
        afterReset,
        resetProgress,
        reset,
        scope:
          "actual computerd 0.4.1 pack apply, lost ACK, sender recreation, frozen target, later write and receiver reset; not production CPU-limit proof",
      });
    } finally {
      await owner.close();
    }
  }

  async runCacheMatrix() {
    this.loseNextAcknowledgement = false;
    const owner = this.makeWorkspace();
    const exec = async (source: string) => {
      using execution = await owner.runtime.exec(source, {
        backend: "container",
        encoding: "utf8",
        timeoutMs: 30_000,
      });
      const result = await execution.result();
      check(result.exitCode === 0, `Matrix read failed: ${result.stderr}`);
      return JSON.parse(result.stdout) as Record<string, unknown>;
    };
    const read = (path: string) =>
      exec(
        `python3 -c 'import pathlib,json; p=pathlib.Path("${path}"); print(json.dumps({"exists":p.exists(),"content":p.read_text() if p.exists() else None,"size":p.stat().st_size if p.exists() else None}))'`
      );
    const records: Array<{
      name: string;
      actual: unknown;
      expected: unknown;
      passed: boolean;
      readAfterWriteMs: number;
    }> = [];
    const readPair = (oldPath: string, renamedPath: string) =>
      exec(
        `python3 -c 'import pathlib,json;\ndef read(s):\n p=pathlib.Path(s); return {"exists":p.exists(),"content":p.read_text() if p.exists() else None,"size":p.stat().st_size if p.exists() else None}\nprint(json.dumps({"old":read("${oldPath}"),"renamed":read("${renamedPath}")}))'`
      );
    const mutate = async (
      name: string,
      action: () => Promise<unknown>,
      inspect: () => Promise<unknown>,
      expected: unknown
    ) => {
      await action();
      const writtenAt = Date.now();
      const actual = await inspect();
      records.push({
        name,
        actual,
        expected,
        passed: JSON.stringify(actual) === JSON.stringify(expected),
        readAfterWriteMs: Date.now() - writtenAt,
      });
    };
    try {
      await owner.ready();
      await owner.fs.mkdir(ROOT, { recursive: true });
      const value = `${ROOT}/matrix-value.txt`;
      const renamed = `${ROOT}/matrix-renamed.txt`;
      const created = `${ROOT}/matrix-created.txt`;
      await owner.fs.writeFile(value, "before\n");
      const initialMount = await this.inspectMount(owner);
      const runtimeId = this.nativeHandle?.runtimeId;
      await read(value);
      await mutate(
        "cached same-size overwrite",
        () => owner.fs.writeFile(value, "after!\n"),
        () => read(value),
        { exists: true, content: "after!\n", size: 7 }
      );
      await read(value);
      await read(renamed);
      await mutate(
        "rename cached source to absent target",
        () => owner.fs.rename(value, renamed),
        () => readPair(value, renamed),
        {
          old: { exists: false, content: null, size: null },
          renamed: { exists: true, content: "after!\n", size: 7 },
        }
      );
      await read(renamed);
      await mutate(
        "delete cached path",
        () => owner.fs.rm(renamed),
        () => read(renamed),
        { exists: false, content: null, size: null }
      );
      await owner.fs.writeFile(value, "older!\n");
      await read(value);
      await mutate(
        "delete and recreate cached path",
        async () => {
          await owner.fs.rm(value);
          await owner.fs.writeFile(value, "newer!\n");
        },
        () => read(value),
        { exists: true, content: "newer!\n", size: 7 }
      );
      await read(created);
      await mutate(
        "create after absent lookup",
        () => owner.fs.writeFile(created, "created\n"),
        () => read(created),
        { exists: true, content: "created\n", size: 8 }
      );
      await read(value);
      await mutate(
        "changed size metadata",
        () => owner.fs.writeFile(value, "a longer file value\n"),
        () => read(value),
        { exists: true, content: "a longer file value\n", size: 20 }
      );
      const directory = `${ROOT}/cached-directory`;
      const movedDirectory = `${ROOT}/moved-directory`;
      await owner.fs.mkdir(`${directory}/deep`, { recursive: true });
      await owner.fs.writeFile(`${directory}/deep/file.txt`, "nested\n");
      await read(`${directory}/deep/file.txt`);
      await read(`${movedDirectory}/deep/file.txt`);
      await mutate(
        "rename cached directory and descendant",
        () => owner.fs.rename(directory, movedDirectory),
        () =>
          readPair(
            `${directory}/deep/file.txt`,
            `${movedDirectory}/deep/file.txt`
          ),
        {
          old: { exists: false, content: null, size: null },
          renamed: { exists: true, content: "nested\n", size: 7 },
        }
      );
      const replacement = `${ROOT}/replacement-source.txt`;
      this.captureReplacement = true;
      // Equal timestamps are legal. Use the SDK's public clock option so this
      // case always exercises an equal-mtime/size replacement, even under load.
      this.sourceTime = Date.now();
      await owner.fs.writeFile(replacement, "source\n");
      await owner.fs.writeFile(value, "target\n");
      this.sourceTime = undefined;
      const replacementBefore = {
        source: await owner.fs.stat(replacement),
        target: await owner.fs.stat(value),
      };
      check(
        replacementBefore.source.mtime === replacementBefore.target.mtime &&
          replacementBefore.source.size === replacementBefore.target.size,
        "Replacement inputs must have equal source mtime and size"
      );
      await read(replacement);
      await read(value);
      let replacementSender: { oldPaths: string[]; target: string } | undefined;
      await mutate(
        "rename over cached same-size target",
        async () => {
          await owner.fs.rename(replacement, value);
          replacementSender = {
            oldPaths: await owner.fs.ls(replacement),
            target: await owner.fs.readFile(value, { encoding: "utf8" }),
          };
        },
        () => readPair(replacement, value),
        {
          old: { exists: false, content: null, size: null },
          renamed: { exists: true, content: "source\n", size: 7 },
        }
      );
      const replacementState = {
        before: replacementBefore,
        beforeExecution: replacementSender,
        sender: {
          oldPaths: await owner.fs.ls(replacement),
          target: await owner.fs.readFile(value, { encoding: "utf8" }),
        },
        receiver: {
          old: await this.nativeHandle?.rpc.sync.readEntry(replacement),
          target: await this.readNativeDatabase(value),
        },
        pushes: this.replacementPushes,
      };
      this.captureReplacement = false;
      await owner.fs.writeFile(`${ROOT}/replay-deleted.txt`, "original");
      await owner.fs.writeFile(`${ROOT}/replay-modified.txt`, "original");
      for await (const _ of owner.push("container")) {
        /* Establish the actual entries-mode baseline. */
      }
      await owner.fs.rm(`${ROOT}/replay-deleted.txt`);
      await owner.fs.writeFile(`${ROOT}/replay-modified.txt`, "sender change");
      this.loseEntriesAcknowledgement = true;
      let lostEntries = false;
      try {
        for await (const _ of owner.push("container")) {
          /* Lose the actual ACK after receiver writes. */
        }
      } catch (error) {
        lostEntries = String(error).includes(
          "PROBE_ENTRIES_ACK_LOST_AFTER_RECEIVER_WRITES"
        );
      }
      check(lostEntries, "The actual entries acknowledgment must be lost");
      check(this.nativeHandle, "Native receiver must remain connected");
      const acceptedBeforeReplay =
        await this.nativeHandle.rpc.sync.watermarks();
      for await (const _ of owner.push("container")) {
        /* Replay through the real peer and its retained source cursor. */
      }
      const entriesReplay = await this.execNative(
        `python3 -c 'import pathlib,json; p=pathlib.Path("${ROOT}"); print(json.dumps({"deleted":(p/"replay-deleted.txt").read_text(),"modified":(p/"replay-modified.txt").read_text()}))'`
      );
      const acceptedAfterReplay = await this.nativeHandle.rpc.sync.watermarks();
      const expectedReplay = {
        deleted: "receiver recreation",
        modified: "receiver modification",
      };
      records.push({
        name: "lost entries ACK preserves newer receiver writes",
        actual: entriesReplay,
        expected: expectedReplay,
        passed:
          JSON.stringify(entriesReplay) === JSON.stringify(expectedReplay),
        readAfterWriteMs: 0,
      });
      const replayState = {
        acknowledgement: this.entriesAcknowledgement,
        acceptedBeforeReplay,
        acceptedAfterReplay,
        receiver: entriesReplay,
      };
      const bench = `${ROOT}/metadata-benchmark`;
      await owner.fs.mkdir(bench, { recursive: true });
      for (let i = 0; i < 500; i++) {
        await owner.fs.mkdir(`${bench}/entry-${i}`);
      }
      const statCost = await exec(
        `python3 -c 'import os,time,json; p="${bench}"; paths=[p+"/"+s for s in os.listdir(p)]; samples=[]; hot=[];\nfor _ in range(3):\n t=time.perf_counter(); [os.stat(s) for s in paths]; samples.append(round((time.perf_counter()-t)*1000,3))\nfor _ in range(3):\n t=time.perf_counter(); [os.stat(s) for _ in range(20) for s in paths[:50]]; hot.append(round((time.perf_counter()-t)*1000,3))\nprint(json.dumps({"paths":len(paths),"statPassMs":samples,"hotPaths":50,"hotStatCallsPerPass":1000,"hotStatPassMs":hot}))'`
      );
      const readBench = `${ROOT}/read-benchmark`;
      await owner.fs.mkdir(readBench, { recursive: true });
      for (let i = 0; i < 10; i++) {
        await owner.fs.writeFile(
          `${readBench}/file-${i}`,
          `file-${i}\n${"x".repeat(65_536)}`
        );
      }
      const readCost = await exec(
        `python3 -c 'import os,time,json; p="${readBench}"; paths=[p+"/"+s for s in os.listdir(p)]; reopened=[]; retained=[];\nfor _ in range(3):\n t=time.perf_counter(); total=0\n for path in paths:\n  for _ in range(10):\n   with open(path,"rb") as f: total+=len(f.read())\n reopened.append(round((time.perf_counter()-t)*1000,3))\nfor _ in range(3):\n t=time.perf_counter(); total=0\n for path in paths:\n  with open(path,"rb") as f:\n   for _ in range(10):\n    f.seek(0); total+=len(f.read())\n retained.append(round((time.perf_counter()-t)*1000,3))\nprint(json.dumps({"files":len(paths),"readsPerPass":len(paths)*10,"bytesPerPass":total,"reopenReadPassMs":reopened,"sameOpenReadPassMs":retained}))'`
      );
      const cost = { stat: statCost, read: readCost };
      const mount = await this.inspectMount(owner);
      check(
        runtimeId && runtimeId === this.nativeHandle?.runtimeId,
        "Mutation matrix must not cross a native runtime replacement"
      );
      return Response.json({
        records,
        replacementState,
        replayState,
        cost,
        mount,
        initialMount,
        runtimeId,
        profile: this.env.FUSE_PROFILE ?? "candidate",
        scope:
          "actual public runtime.exec mutation and stat-cost matrix, no production CPU or live-rollout claim",
      });
    } finally {
      await owner.close();
    }
  }

  async runAdoption() {
    this.loseNextAcknowledgement = false;
    this.native = this.makeNative({ MOUNT_POINT: "/computer" });
    let owner = this.makeWorkspace();
    const storage = new ComputerCommandSqlStorage(this.ctx.storage.sql);
    const tool = () =>
      createComputerCommandTool({
        context: { submissionId: "native-config-adoption" },
        storage,
        workingDirectory: ROOT,
        workspaceAccess: {
          withWorkspace: async (operation) => {
            using client = await getWorkspace(owner);
            return await operation(client);
          },
        },
      });
    try {
      await owner.ready();
      await owner.fs.mkdir(ROOT, { recursive: true });
      await owner.fs.writeFile(
        `${ROOT}/retained-config.txt`,
        "retained-data\n"
      );
      const beforeMount = await this.inspectMount(owner);
      const beforeRuntimeId = this.nativeHandle?.runtimeId;
      const completedStart = {
        action: "start",
        key: "completed-original",
        command: "printf 'retained-command\\n'",
      };
      const completed = (await tool().execute(completedStart)) as {
        id: string;
        status: string;
        stdout: string;
        reference: unknown;
      };
      check(
        completed.status === "completed" &&
          completed.stdout === "retained-command\n",
        "Original command must complete before adoption"
      );
      const pending = (await tool().execute({
        action: "start",
        key: "pending-original",
        command:
          "python3 -u -c 'import time; print(\"pending-original\",flush=True); time.sleep(120)'",
      })) as { id: string; status: string; stdout: string; reference: unknown };
      check(
        pending.status === "running" &&
          pending.stdout.includes("pending-original"),
        "Original native process must be observed running"
      );
      await owner.close();
      // The SDK's own launch-spec comparison replaces the existing native
      // generation. The retained Workspace and product receipt SQLite stay.
      this.native = this.makeNative(this.containerEnv);
      owner = this.makeWorkspace();
      const afterMount = await this.inspectMount(owner);
      const afterRuntimeId = this.nativeHandle?.runtimeId;
      check(
        beforeRuntimeId && afterRuntimeId && beforeRuntimeId !== afterRuntimeId,
        "Changed configuration must replace the old native generation"
      );
      using read = await owner.runtime.exec(`cat ${ROOT}/retained-config.txt`, {
        backend: "container",
        encoding: "utf8",
        timeoutMs: 10_000,
      });
      const retainedFile = await read.result();
      check(
        retainedFile.exitCode === 0 &&
          retainedFile.stdout === "retained-data\n",
        "Configuration adoption must retain durable files"
      );
      const replay = (await tool().execute(completedStart)) as typeof completed;
      check(
        replay.id === completed.id &&
          replay.stdout === completed.stdout &&
          replay.status === "completed",
        "Completed product receipt must survive native replacement"
      );
      let loss: { code?: string; message?: string } | undefined;
      try {
        await tool().execute({
          action: "poll",
          key: "pending-original",
          reference: pending.reference,
          waitSeconds: 0,
        });
      } catch (error) {
        loss = error as typeof loss;
      }
      check(
        loss?.code === "computer.execution_result_unavailable",
        `Lost original process must be reported explicitly: ${String(loss?.message)}`
      );
      const rows = (await tool().execute({
        action: "list",
        includeReceiptDetails: true,
      })) as Array<{ id: string; reference: unknown; phase: string }>;
      const pendingAfter = rows.find((row) => row.id === pending.id);
      check(
        pendingAfter?.phase === "result_unavailable" &&
          JSON.stringify(pendingAfter.reference) ===
            JSON.stringify(pending.reference),
        "Lost native command must retain its original reference"
      );
      check(
        this.execIds.filter((id) => id === completed.id).length === 1 &&
          this.execIds.filter((id) => id === pending.id).length === 1,
        "Neither original command may be replayed after configuration adoption"
      );
      await owner.close();
      owner = this.makeWorkspace();
      await owner.ready("container");
      check(
        this.nativeHandle?.runtimeId === afterRuntimeId,
        "A reconnect with the same configuration must adopt the existing native generation"
      );
      return Response.json({
        beforeMount,
        afterMount,
        beforeRuntimeId,
        afterRuntimeId,
        retainedFile: {
          stdout: retainedFile.stdout,
          exitCode: retainedFile.exitCode,
        },
        completed: {
          id: completed.id,
          reference: completed.reference,
          stdout: completed.stdout,
        },
        replay: { id: replay.id, stdout: replay.stdout },
        pending: { id: pending.id, reference: pending.reference },
        pendingAfter,
        loss: { code: loss.code, message: loss.message },
        originalExecCounts: {
          completed: this.execIds.filter((id) => id === completed.id).length,
          pending: this.execIds.filter((id) => id === pending.id).length,
        },
        scope:
          "actual SDK configuration adoption on a live native Computer with retained Workspace and OpenMeld command receipts; not production rollout or uninterrupted-process proof",
      });
    } finally {
      await owner.close();
    }
  }
}

export default {
  fetch(request: Request, env: ProbeEnv) {
    return env.PROBE.get(
      env.PROBE.idFromName("computer-container-check")
    ).fetch(request);
  },
};
