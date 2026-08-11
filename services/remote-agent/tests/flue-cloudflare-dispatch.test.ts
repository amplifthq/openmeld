import { readdir, readFile } from "node:fs/promises";
import { findPackageJSON } from "node:module";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  type AgentExecutionStore,
  type AgentSubmission,
  createCloudflareAgentRuntime,
  type FlueContextInternal,
  InMemoryAttachmentStore,
  InMemoryConversationStreamStore,
} from "@flue/runtime/internal";
import { describe, expect, it, vi } from "vitest";

describe("Flue Cloudflare dispatch patch", () => {
  it("settles an exhausted interrupted submission without initializing the agent", async () => {
    const submissionId = "submission-exhausted-before-agent-initialization";
    const attemptId = "attempt-exhausted-before-agent-initialization";
    const durableObjectId = "durable-object-center-agent-exhausted";
    const runningSubmission: AgentSubmission = {
      acceptedAt: Date.parse("2026-08-01T00:00:00.000Z"),
      attemptCount: 5,
      attemptId,
      canonicalReadyAt: Date.parse("2026-08-01T00:00:00.000Z"),
      input: {
        acceptedAt: "2026-08-01T00:00:00.000Z",
        agent: "center-agent",
        dispatchId: submissionId,
        id: "space-exhausted",
        input: { message: "Finish or fail visibly." },
        kind: "dispatch",
        submissionId,
      },
      inputAppliedAt: Date.parse("2026-08-01T00:00:00.000Z"),
      kind: "dispatch",
      leaseExpiresAt: 0,
      maxRetry: 5,
      ownerId: durableObjectId,
      sequence: 1,
      sessionKey: "agent:space-exhausted:default:default",
      startedAt: Date.parse("2026-08-01T00:00:00.000Z"),
      status: "running",
      submissionId,
      timeoutAt: 0,
    };
    let unsettled = true;
    const failSubmission = vi.fn(() => {
      unsettled = false;
      return Promise.resolve(true);
    });
    const initializeRootHarness = vi.fn(() =>
      Promise.reject(
        new Error("The agent initializer must not run after retry exhaustion.")
      )
    );
    const submissions = {
      deleteAttemptMarker: () => Promise.resolve(),
      failSubmission,
      getSubmission: () => Promise.resolve(runningSubmission),
      hasUnsettledSubmissions: () => Promise.resolve(unsettled),
      listAttemptMarkers: () => Promise.resolve([]),
      listPendingSubmissionSettlements: () => Promise.resolve([]),
      listRunnableSubmissions: () => Promise.resolve([]),
      listRunningSubmissions: () =>
        Promise.resolve(unsettled ? [runningSubmission] : []),
      listUnreadySubmissions: () => Promise.resolve([]),
    };
    const prepared = {
      agentName: "center-agent",
      attachmentStore: new InMemoryAttachmentStore(),
      conversationStreamStore: new InMemoryConversationStreamStore(),
      executionStore: { submissions } as unknown as AgentExecutionStore,
    };
    const runtime = createCloudflareAgentRuntime({
      agents: [{ definition: {} as never, name: "center-agent" }],
      createContext: () =>
        ({ initializeRootHarness }) as unknown as FlueContextInternal,
      runWithInstanceContext: (_instance, _agentName, callback) => callback(),
    });
    const instance = {
      __unsafe_ensureInitialized: () => Promise.resolve(),
      ctx: {
        id: { toString: () => durableObjectId },
        storage: {},
      },
      env: {},
      name: "space-exhausted",
      runFiber: async (
        _name: string,
        callback: (ctx: { stash(snapshot: unknown): void }) => Promise<void>
      ) => await callback({ stash: () => undefined }),
      schedule: () => Promise.resolve(),
    };

    runtime.attach(instance, prepared);
    await runtime.wakeSubmissions(instance);

    expect(failSubmission).toHaveBeenCalledOnce();
    expect(initializeRootHarness).not.toHaveBeenCalled();
  });

  it("exposes a lightweight submission read to Cloudflare extensions", async () => {
    const submission = {
      acceptedAt: 1000,
      attemptCount: 5,
      canonicalReadyAt: 1000,
      error: "Agent submission exhausted its retry budget.",
      input: {
        acceptedAt: "1970-01-01T00:00:01.000Z",
        agent: "center-agent",
        dispatchId: "submission-terminal",
        id: "space-terminal",
        input: { message: "Hello" },
        kind: "dispatch" as const,
        submissionId: "submission-terminal",
      },
      kind: "dispatch" as const,
      leaseExpiresAt: 0,
      maxRetry: 5,
      sequence: 1,
      sessionKey: "agent:space-terminal:default:default",
      status: "settled" as const,
      submissionId: "submission-terminal",
      timeoutAt: 0,
    } satisfies AgentSubmission;
    const getSubmission = vi.fn(async () => submission);
    const prepared = {
      agentName: "center-agent",
      attachmentStore: new InMemoryAttachmentStore(),
      conversationStreamStore: new InMemoryConversationStreamStore(),
      executionStore: {
        submissions: { getSubmission },
      } as unknown as AgentExecutionStore,
    };
    const runtime = createCloudflareAgentRuntime({
      agents: [{ definition: {} as never, name: "center-agent" }],
      createContext: () => ({}) as FlueContextInternal,
      runWithInstanceContext: (_instance, _agentName, callback) => callback(),
    });
    const instance = {
      __unsafe_ensureInitialized: () => Promise.resolve(),
      ctx: {
        id: { toString: () => "durable-object-terminal" },
        storage: {},
      },
      env: {},
      name: "space-terminal",
      runFiber: (
        _name: string,
        callback: (ctx: { stash(snapshot: unknown): void }) => Promise<void>
      ) => callback({ stash: () => undefined }),
      schedule: () => Promise.resolve(),
    };

    runtime.attach(instance, prepared);

    await expect(
      (
        instance as typeof instance & {
          __unsafe_readSubmission(
            submissionId: string
          ): Promise<AgentSubmission | null>;
        }
      ).__unsafe_readSubmission(submission.submissionId)
    ).resolves.toEqual(submission);
    expect(getSubmission).toHaveBeenCalledWith(submission.submissionId);
  });

  it("recovers a durable submission after the Durable Object instance is replaced", async () => {
    const submissionId = "submission-recovered-after-instance-replacement";
    const attemptId = "attempt-interrupted-by-instance-replacement";
    const durableObjectId = "durable-object-center-agent-space-recovery";
    const input = {
      acceptedAt: "2026-08-01T00:00:00.000Z",
      agent: "center-agent",
      dispatchId: submissionId,
      id: "space-recovery",
      input: { message: "Recover this submission." },
      kind: "dispatch" as const,
      submissionId,
    };
    const runningSubmission: AgentSubmission = {
      acceptedAt: Date.parse(input.acceptedAt),
      attemptCount: 1,
      attemptId,
      canonicalReadyAt: Date.parse(input.acceptedAt),
      input,
      inputAppliedAt: Date.parse(input.acceptedAt),
      kind: "dispatch",
      leaseExpiresAt: 0,
      maxRetry: 10,
      ownerId: durableObjectId,
      sequence: 1,
      sessionKey: "agent:space-recovery:default:default",
      startedAt: Date.parse(input.acceptedAt),
      status: "running",
      submissionId,
      timeoutAt: Date.parse("2026-08-02T00:00:00.000Z"),
    };

    let unsettled = true;
    let claimed = false;
    let runFiberCalls = 0;
    let completeSubmissionCalls = 0;
    let releaseOldFiber: (() => void) | undefined;
    const oldFiber = new Promise<void>((resolve) => {
      releaseOldFiber = resolve;
    });
    const submissions = {
      claimSubmission: () => {
        claimed = true;
        return Promise.resolve(runningSubmission);
      },
      completeSubmission: () => {
        completeSubmissionCalls += 1;
        unsettled = false;
        return Promise.resolve(true);
      },
      deleteAttemptMarker: () => Promise.resolve(),
      hasUnsettledSubmissions: () => Promise.resolve(unsettled),
      insertAttemptMarker: () => Promise.resolve(),
      listAttemptMarkers: () => Promise.resolve([]),
      listPendingSubmissionSettlements: () => Promise.resolve([]),
      listRunnableSubmissions: () =>
        Promise.resolve(
          claimed
            ? []
            : [
                {
                  ...runningSubmission,
                  attemptId: undefined,
                  status: "queued" as const,
                },
              ]
        ),
      listRunningSubmissions: () =>
        Promise.resolve(claimed ? [runningSubmission] : []),
      listUnreadySubmissions: () => Promise.resolve([]),
      requestSubmissionRecovery: () => Promise.resolve(true),
    };
    const prepared = {
      agentName: "center-agent",
      attachmentStore: new InMemoryAttachmentStore(),
      conversationStreamStore: new InMemoryConversationStreamStore(),
      executionStore: { submissions } as unknown as AgentExecutionStore,
    };
    const recoveredSession = {
      inspectSubmissionInput: async () => "completed" as const,
      reconstructSubmissionResult: async () => ({ text: "Recovered." }),
    };
    const runtime = createCloudflareAgentRuntime({
      agents: [{ definition: {} as never, name: "center-agent" }],
      createContext: () =>
        ({
          initializeRootHarness: async () => ({
            session: async () => recoveredSession,
          }),
        }) as unknown as FlueContextInternal,
      runWithInstanceContext: (_instance, _agentName, callback) => callback(),
    });
    const createInstance = () => ({
      __unsafe_ensureInitialized: () => Promise.resolve(),
      ctx: {
        id: { toString: () => durableObjectId },
        storage: {},
      },
      env: {},
      name: "space-recovery",
      runFiber: async () => {
        runFiberCalls += 1;
        await oldFiber;
      },
      schedule: () => Promise.resolve(),
    });
    const interruptedInstance = createInstance();
    const recoveredInstance = createInstance();

    runtime.attach(interruptedInstance, prepared);
    const interruptedWake = runtime.wakeSubmissions(interruptedInstance);

    try {
      await vi.waitFor(() => expect(runFiberCalls).toBe(1));

      runtime.attach(recoveredInstance, prepared);
      await runtime.onFiberRecovered(
        recoveredInstance,
        {
          name: "flue:submission-attempt",
          snapshot: { attemptId, submissionId },
        },
        () => Promise.resolve()
      );
      await runtime.wakeSubmissions(recoveredInstance);

      expect(completeSubmissionCalls).toBe(1);
    } finally {
      releaseOldFiber?.();
      await interruptedWake;
    }
  });

  it("keeps model reconciliation out of Durable Object startup", async () => {
    const runtimePackageJson = findPackageJSON(
      "@flue/runtime",
      import.meta.url
    );

    if (!runtimePackageJson) {
      throw new Error("Could not find Flue's runtime package.");
    }

    const source = await readFile(
      join(dirname(runtimePackageJson), "dist", "internal.mjs"),
      "utf8"
    );
    const coordinatorStart = source.indexOf(
      "var CloudflareAgentCoordinator = class"
    );
    const startupStart = source.indexOf("onStart(inherited)", coordinatorStart);
    const startupEnd = source.indexOf("wakeSubmissions()", startupStart);
    const recoveryStart = source.indexOf(
      "onFiberRecovered(ctx, inherited)",
      coordinatorStart
    );
    const recoveryEnd = source.indexOf("get agentName()", recoveryStart);

    expect(startupStart).toBeGreaterThanOrEqual(0);
    expect(startupEnd).toBeGreaterThan(startupStart);
    expect(recoveryStart).toBeGreaterThanOrEqual(0);
    expect(recoveryEnd).toBeGreaterThan(recoveryStart);

    const startupMethod = source.slice(startupStart, startupEnd);
    const recoveryMethod = source.slice(recoveryStart, recoveryEnd);

    expect(startupMethod).toContain("await this.restoreSubmissionWake()");
    expect(startupMethod).not.toContain("reconcileSubmissions");
    expect(recoveryMethod).toContain("await this.restoreSubmissionWake()");
    expect(recoveryMethod).toContain(
      "await this.submissions.requestSubmissionRecovery"
    );
    expect(recoveryMethod).not.toContain("reconcileSubmissions");
  });

  it("returns durable admission without waiting for the model fiber", async () => {
    const runtimePackageJson = findPackageJSON(
      "@flue/runtime",
      import.meta.url
    );

    if (!runtimePackageJson) {
      throw new Error("Could not find Flue's runtime package.");
    }

    const source = await readFile(
      join(dirname(runtimePackageJson), "dist", "internal.mjs"),
      "utf8"
    );
    const admissionStart = source.indexOf("async admitDispatch(request)");
    const admissionEnd = source.indexOf(
      "function submissionAttemptMarkerKey",
      admissionStart
    );

    expect(admissionStart).toBeGreaterThanOrEqual(0);
    expect(admissionEnd).toBeGreaterThan(admissionStart);

    const admissionMethod = source.slice(admissionStart, admissionEnd);
    const deferredWakeCalls = admissionMethod.match(
      /await this\.armSubmissionWake\(\{ delaySeconds: 1, idempotent: false \}\);/g
    );

    expect(deferredWakeCalls).toHaveLength(2);
    expect(admissionMethod).not.toContain("delaySeconds: 0");
    expect(admissionMethod).not.toContain("reconcileSubmissions");
    expect(admissionMethod).not.toContain("materializeSubmissionConversation");
    expect(admissionMethod).not.toContain("markSubmissionCanonicalReady");
  });

  it("reduces durable conversation history once per read page", async () => {
    const runtimePackageJson = findPackageJSON(
      "@flue/runtime",
      import.meta.url
    );

    if (!runtimePackageJson) {
      throw new Error("Could not find Flue's runtime package.");
    }

    const distDirectory = join(dirname(runtimePackageJson), "dist");
    const conversationModule = (await readdir(distDirectory)).find(
      (entry) => entry.startsWith("flue-app-") && entry.endsWith(".mjs")
    );

    if (!conversationModule) {
      throw new Error("Could not find Flue's conversation runtime module.");
    }

    const source = await readFile(
      join(distDirectory, conversationModule),
      "utf8"
    );
    const loaderStart = source.indexOf(
      "async function loadReducedConversationState(options)"
    );
    const loaderEnd = source.indexOf(
      "async function loadReducedConversationPrefix(options)",
      loaderStart
    );

    expect(loaderStart).toBeGreaterThanOrEqual(0);
    expect(loaderEnd).toBeGreaterThan(loaderStart);

    const loader = source.slice(loaderStart, loaderEnd);

    expect(loader).toContain(
      "const records = read.batches.flatMap((batch) => batch.records)"
    );
    expect(loader).toContain(
      "state = reduceConversationRecords(state, records, read.nextOffset)"
    );
    expect(loader).not.toContain("for (const batch of read.batches)");
  });

  it("logs the exact canonical record that makes conversation replay fail", async () => {
    const runtimePackageJson = findPackageJSON(
      "@flue/runtime",
      import.meta.url
    );

    if (!runtimePackageJson) {
      throw new Error("Could not find Flue's runtime package.");
    }

    const distDirectory = join(dirname(runtimePackageJson), "dist");
    const conversationModule = (await readdir(distDirectory)).find(
      (entry) =>
        entry.startsWith("conversation-projections-") && entry.endsWith(".mjs")
    );

    if (!conversationModule) {
      throw new Error("Could not find Flue's conversation projections module.");
    }

    const source = await readFile(
      join(distDirectory, conversationModule),
      "utf8"
    );
    const failStart = source.indexOf("function fail(record, reason)");
    const failEnd = source.indexOf("//#endregion", failStart);

    expect(failStart).toBeGreaterThanOrEqual(0);
    expect(failEnd).toBeGreaterThan(failStart);
    expect(source.slice(failStart, failEnd)).toContain(
      'console.error("[flue:conversation-record-invalid]", error.meta)'
    );
  });

  it("materializes queued conversation state from the scheduled wake", async () => {
    const runtimePackageJson = findPackageJSON(
      "@flue/runtime",
      import.meta.url
    );

    if (!runtimePackageJson) {
      throw new Error("Could not find Flue's runtime package.");
    }

    const source = await readFile(
      join(dirname(runtimePackageJson), "dist", "internal.mjs"),
      "utf8"
    );
    const coordinatorStart = source.indexOf(
      "var CloudflareAgentCoordinator = class"
    );
    const wakeStart = source.indexOf("wakeSubmissions()", coordinatorStart);
    const wakeEnd = source.indexOf("onRequest(request)", wakeStart);
    const reconcileStart = source.indexOf(
      "async reconcileSubmissions(",
      coordinatorStart
    );
    const reconcileEnd = source.indexOf(
      "logSubmissionReconciliationFailure(",
      reconcileStart
    );

    expect(wakeStart).toBeGreaterThanOrEqual(0);
    expect(wakeEnd).toBeGreaterThan(wakeStart);
    expect(reconcileStart).toBeGreaterThan(wakeEnd);
    expect(reconcileEnd).toBeGreaterThan(reconcileStart);

    const wakeMethod = source.slice(wakeStart, wakeEnd);
    const reconcileMethod = source.slice(reconcileStart, reconcileEnd);

    expect(wakeMethod).toContain("await this.reconcileSubmissions({");
    expect(wakeMethod).toContain("driverAlreadyArmed: true");
    expect(wakeMethod).toContain("awaitAttempts: true");
    expect(reconcileMethod).toContain(
      "this.submissions.listUnreadySubmissions()"
    );
    expect(reconcileMethod).toContain(
      "await this.materializeSubmissionConversation(submission.input, agent)"
    );
    expect(reconcileMethod).toContain(
      "await this.submissions.markSubmissionCanonicalReady"
    );
  });

  it("materializes only the unsettled head of each session", async () => {
    const runtimePackageJson = findPackageJSON(
      "@flue/runtime",
      import.meta.url
    );

    if (!runtimePackageJson) {
      throw new Error("Could not find Flue's runtime package.");
    }

    const distDirectory = join(dirname(runtimePackageJson), "dist");
    const submissionStoreModule = (await readdir(distDirectory)).find(
      (entry) => entry.startsWith("sql-run-store-") && entry.endsWith(".mjs")
    );

    if (!submissionStoreModule) {
      throw new Error("Could not find Flue's submission store module.");
    }

    const source = await readFile(
      join(distDirectory, submissionStoreModule),
      "utf8"
    );
    const unreadyStart = source.indexOf("async listUnreadySubmissions()");
    const unreadyEnd = source.indexOf(
      "async listRunnableSubmissions()",
      unreadyStart
    );

    expect(unreadyStart).toBeGreaterThanOrEqual(0);
    expect(unreadyEnd).toBeGreaterThan(unreadyStart);

    const unreadyMethod = source.slice(unreadyStart, unreadyEnd);

    expect(unreadyMethod).toContain("FROM flue_agent_submissions AS current");
    expect(unreadyMethod).toContain("AND NOT EXISTS (");
    expect(unreadyMethod).toContain(
      "WHERE earlier.session_key = current.session_key"
    );
    expect(unreadyMethod).toContain(
      "AND earlier.status IN ('queued', 'running', 'terminalizing')"
    );
    expect(unreadyMethod).toContain("AND earlier.sequence < current.sequence");
  });

  it("distinguishes a later canonical dispatch from same-turn continuation signals", async () => {
    const runtimePackageJson = findPackageJSON(
      "@flue/runtime",
      import.meta.url
    );

    if (!runtimePackageJson) {
      throw new Error("Could not find Flue's runtime package.");
    }

    const distDirectory = join(dirname(runtimePackageJson), "dist");
    const projectionsModule = (await readdir(distDirectory)).find(
      (entry) =>
        entry.startsWith("conversation-projections-") && entry.endsWith(".mjs")
    );

    if (!projectionsModule) {
      throw new Error("Could not find Flue's conversation projections module.");
    }

    const runtime = (await import(
      pathToFileURL(join(distDirectory, projectionsModule)).href
    )) as {
      n: (
        conversation: {
          activeLeafId: string;
          entries: Map<string, unknown>;
          inProgressMessages: Map<string, unknown>;
        },
        inputEntryId: string,
        options: { contextWindow: number }
      ) => { kind: string };
    };
    const interruptedInputId = "entry_dispatch_r";
    const laterInputId = "entry_dispatch_v";
    const laterAssistantId = "entry_assistant_v";
    const entries = new Map<string, unknown>([
      [
        interruptedInputId,
        {
          id: interruptedInputId,
          message: {
            attributes: {},
            content: "Reply with R.",
            role: "signal",
            tagName: "dispatch",
            timestamp: 1,
            type: "dispatch_input",
          },
          parentId: null,
          timestamp: 1,
          type: "message",
        },
      ],
      [
        laterInputId,
        {
          id: laterInputId,
          message: {
            attributes: {},
            content: "Reply with V.",
            role: "signal",
            tagName: "dispatch",
            timestamp: 2,
            type: "dispatch_input",
          },
          parentId: interruptedInputId,
          timestamp: 2,
          type: "message",
        },
      ],
      [
        laterAssistantId,
        {
          id: laterAssistantId,
          message: {
            content: [{ text: "Acknowledged V", type: "text" }],
            role: "assistant",
            stopReason: "stop",
            timestamp: 3,
          },
          parentId: laterInputId,
          timestamp: 3,
          type: "message",
        },
      ],
    ]);

    expect(
      runtime.n(
        {
          activeLeafId: laterAssistantId,
          entries,
          inProgressMessages: new Map(),
        },
        interruptedInputId,
        { contextWindow: 0 }
      )
    ).toEqual({ kind: "advanced_past_input" });

    const interruptedAssistantId = "entry_assistant_interrupted";
    const continuationSignalId = "entry_stream_continued";
    const continuationEntries = new Map<string, unknown>([
      [
        interruptedInputId,
        {
          id: interruptedInputId,
          message: {
            attributes: {},
            content: "Reply with R.",
            role: "signal",
            tagName: "dispatch",
            timestamp: 1,
            type: "dispatch_input",
          },
          parentId: null,
          timestamp: 1,
          type: "message",
        },
      ],
      [
        interruptedAssistantId,
        {
          id: interruptedAssistantId,
          message: {
            content: [],
            role: "assistant",
            stopReason: "aborted",
            timestamp: 2,
          },
          parentId: interruptedInputId,
          timestamp: 2,
          type: "message",
        },
      ],
      [
        continuationSignalId,
        {
          id: continuationSignalId,
          message: {
            attributes: {},
            content: "",
            role: "signal",
            tagName: "stream",
            timestamp: 3,
            type: "stream_continued",
          },
          parentId: interruptedAssistantId,
          timestamp: 3,
          type: "message",
        },
      ],
    ]);

    expect(
      runtime.n(
        {
          activeLeafId: continuationSignalId,
          entries: continuationEntries,
          inProgressMessages: new Map(),
        },
        interruptedInputId,
        { contextWindow: 0 }
      )
    ).toMatchObject({
      kind: "resume",
      mode: "stream_continuation",
    });
  });

  it("keeps same-session work durable across submission settlement", async () => {
    const runtimePackageJson = findPackageJSON(
      "@flue/runtime",
      import.meta.url
    );

    if (!runtimePackageJson) {
      throw new Error("Could not find Flue's runtime package.");
    }

    const distDirectory = join(dirname(runtimePackageJson), "dist");
    const coordinatorSource = await readFile(
      join(distDirectory, "internal.mjs"),
      "utf8"
    );
    const conversationModule = (await readdir(distDirectory)).find(
      (entry) =>
        entry.startsWith("conversation-stream-store-") && entry.endsWith(".mjs")
    );

    if (!conversationModule) {
      throw new Error("Could not find Flue's conversation store module.");
    }

    const conversationSource = await readFile(
      join(distDirectory, conversationModule),
      "utf8"
    );
    const processStart = conversationSource.indexOf(
      "async function processSubmission(opts)"
    );
    const processEnd = conversationSource.indexOf(
      "async function failInterruptedSubmission",
      processStart
    );
    const coordinatorStart = coordinatorSource.indexOf(
      "var CloudflareAgentCoordinator = class"
    );
    const entryStart = coordinatorSource.indexOf(
      "async processSubmissionEntry(submission, signal)",
      coordinatorStart
    );
    const entryEnd = coordinatorSource.indexOf(
      "async admitAttachedSubmission",
      entryStart
    );

    expect(processStart).toBeGreaterThanOrEqual(0);
    expect(processEnd).toBeGreaterThan(processStart);
    expect(entryStart).toBeGreaterThanOrEqual(0);
    expect(entryEnd).toBeGreaterThan(entryStart);

    const processMethod = conversationSource.slice(processStart, processEnd);
    const entryMethod = coordinatorSource.slice(entryStart, entryEnd);

    expect(processMethod).toContain("await opts.onSettled?.()");
    expect(entryMethod).toContain("onSettled: () =>");
    expect(entryMethod).toContain(
      "return this.armSubmissionWake({ delaySeconds: 1, idempotent: false }).catch"
    );
  });

  it("releases settled attempts from the fiber callback", async () => {
    const runtimePackageJson = findPackageJSON(
      "@flue/runtime",
      import.meta.url
    );

    if (!runtimePackageJson) {
      throw new Error("Could not find Flue's runtime package.");
    }

    const source = await readFile(
      join(dirname(runtimePackageJson), "dist", "internal.mjs"),
      "utf8"
    );
    const coordinatorStart = source.indexOf(
      "var CloudflareAgentCoordinator = class"
    );
    const attemptStart = source.indexOf(
      "async startSubmissionAttempt(submission, options = {})",
      coordinatorStart
    );
    const attemptEnd = source.indexOf("async abortInstance()", attemptStart);

    expect(attemptStart).toBeGreaterThanOrEqual(0);
    expect(attemptEnd).toBeGreaterThan(attemptStart);

    const attemptMethod = source.slice(attemptStart, attemptEnd);
    const fiberStart = attemptMethod.indexOf("this.instance.runFiber(");
    const outerPromiseHandlersStart = attemptMethod.indexOf("running.catch(");

    expect(fiberStart).toBeGreaterThanOrEqual(0);
    expect(outerPromiseHandlersStart).toBeGreaterThan(fiberStart);

    const fiberCallback = attemptMethod.slice(
      fiberStart,
      outerPromiseHandlersStart
    );

    expect(fiberCallback).toContain("finally {");
    expect(fiberCallback).toContain(
      "await this.releaseSubmissionAttempt(attemptKey, submission.submissionId, attempt)"
    );
    expect(attemptMethod).toContain(
      "async releaseSubmissionAttempt(attemptKey, submissionId, attempt)"
    );
  });

  it("keeps scheduled submission fibers inside the alarm invocation", async () => {
    const runtimePackageJson = findPackageJSON(
      "@flue/runtime",
      import.meta.url
    );

    if (!runtimePackageJson) {
      throw new Error("Could not find Flue's runtime package.");
    }

    const source = await readFile(
      join(dirname(runtimePackageJson), "dist", "internal.mjs"),
      "utf8"
    );
    const coordinatorStart = source.indexOf(
      "var CloudflareAgentCoordinator = class"
    );
    const attemptStart = source.indexOf(
      "async startSubmissionAttempt(submission, options = {})",
      coordinatorStart
    );
    const attemptEnd = source.indexOf("async abortInstance()", attemptStart);

    expect(attemptStart).toBeGreaterThanOrEqual(0);
    expect(attemptEnd).toBeGreaterThan(attemptStart);

    const attemptMethod = source.slice(attemptStart, attemptEnd);
    const fiberStart = attemptMethod.indexOf(
      "running = this.instance.runFiber("
    );
    const settledPromise = attemptMethod.indexOf(
      "const settled = running.catch(",
      fiberStart
    );
    const awaitedSettlement = attemptMethod.indexOf(
      "if (options.awaitCompletion) await settled",
      settledPromise
    );
    const releaseStart = attemptMethod.indexOf(
      "async releaseSubmissionAttempt(attemptKey, submissionId, attempt)"
    );
    const ownedAttempt = attemptMethod.indexOf(
      "const ownedAttempt = this.activeAttempts.delete(attemptKey)",
      releaseStart
    );
    const durableWake = attemptMethod.indexOf(
      "await this.armSubmissionWake({ delaySeconds: 1, idempotent: false })",
      ownedAttempt
    );

    expect(fiberStart).toBeGreaterThanOrEqual(0);
    expect(settledPromise).toBeGreaterThan(fiberStart);
    expect(awaitedSettlement).toBeGreaterThan(settledPromise);
    expect(releaseStart).toBeGreaterThanOrEqual(0);
    expect(ownedAttempt).toBeGreaterThan(releaseStart);
    expect(attemptMethod).toContain("if (!ownedAttempt) return");
    expect(durableWake).toBeGreaterThan(ownedAttempt);
    expect(attemptMethod).not.toContain("this.instance.ctx.waitUntil(settled)");
    expect(attemptMethod).not.toContain("setTimeout(resolve, 0)");
    expect(attemptMethod).not.toContain("post_fiber_handoff");
    expect(attemptMethod).not.toContain("async continueSubmissionQueue()");
    expect(attemptMethod).not.toContain("}).finally(async () => {");

    const wakeStart = source.indexOf("wakeSubmissions()", coordinatorStart);
    const wakeEnd = source.indexOf("onRequest(request)", wakeStart);
    expect(wakeStart).toBeGreaterThanOrEqual(0);
    expect(wakeEnd).toBeGreaterThan(wakeStart);
    const wakeMethod = source.slice(wakeStart, wakeEnd);
    expect(wakeMethod).toContain("await this.reconcileSubmissions({");
    expect(wakeMethod).toContain("driverAlreadyArmed: true");
    expect(wakeMethod).toContain("awaitAttempts: true");
  });
});
