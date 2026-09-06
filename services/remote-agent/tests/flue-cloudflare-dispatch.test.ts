import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import { defineTool, setProvider, useModel, useTool } from "@flue/runtime";
import {
  createCloudflareAgentRuntime,
  createFlueContext,
  resolveModel,
} from "@flue/runtime/internal";
import { sqlite } from "@flue/runtime/node";
import { object } from "valibot";
import { describe, expect, it } from "vitest";

describe("Flue Cloudflare execution boundary", () => {
  it("recovers interrupted model work without repeating a recorded external action", async () => {
    const provider = fauxProvider({
      provider: "cf-recovery",
      tokensPerSecond: Number.POSITIVE_INFINITY,
    });
    setProvider(provider.provider);
    const model = provider.getModel();
    let actionCount = 0;
    const action = defineTool({
      name: "record_action",
      description: "Record one external action.",
      input: object({}),
      run: () => ({ output: { receipt: `receipt-${++actionCount}` } }),
    });
    function Center() {
      useModel(`${model.provider}/${model.id}`);
      useTool(action);
      return "Record the action once, then report its receipt.";
    }
    Center.durability = { maxAttempts: 5, timeoutMs: 0 };
    const database = sqlite();
    await database.migrate?.();
    const stores = await database.connect();
    const runtime = createCloudflareAgentRuntime({
      agents: [{ agent: Center, name: "center-agent-v2" }],
      createContext: ({ agentName, instance, request, submissionId }) =>
        createFlueContext({
          agentConfig: { resolveModel },
          agentName,
          env: {},
          id: instance.name,
          req: request,
          submissionId,
        }),
      runWithInstanceContext: (_instance, _agent, callback) => callback(),
    });
    function owner() {
      const fibers: Promise<void>[] = [];
      const instance = {
        ctx: { id: { toString: () => "same-durable-object" }, storage: {} },
        env: {},
        name: "session",
        schedule: async () => undefined,
        runFiber: (
          _name: string,
          callback: (context: {
            stash(snapshot: unknown): void;
          }) => Promise<void>
        ) => {
          const fiber = callback({ stash: () => undefined });
          fibers.push(fiber);
          return fiber;
        },
      };
      runtime.attach(instance, { agentName: "center-agent-v2", ...stores });
      return { instance, fibers };
    }
    const reachedModel = Promise.withResolvers<void>();
    const releaseOldModel =
      Promise.withResolvers<ReturnType<typeof fauxAssistantMessage>>();
    provider.setResponses([
      fauxAssistantMessage(fauxToolCall("record_action", {}), {
        stopReason: "toolUse",
      }),
      () => {
        reachedModel.resolve();
        return releaseOldModel.promise;
      },
    ]);
    const first = owner();
    try {
      await runtime.onStart(first.instance, () => undefined);
      await runtime.onRequest(
        first.instance,
        new Request("https://flue.internal/__flue/internal/dispatch", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            submissionId: "running",
            agent: "center-agent-v2",
            id: "session",
            acceptedAt: new Date().toISOString(),
            message: { kind: "user", body: "Record the action." },
          }),
        })
      );
      await runtime.drainSubmissions(first.instance);
      await reachedModel.promise;
      expect(actionCount).toBe(1);
      expect(
        await stores.submissionStore.getSubmission("running")
      ).toMatchObject({ status: "running" });
      provider.setResponses([
        (context) => {
          expect(JSON.stringify(context.messages)).toContain("receipt-1");
          return fauxAssistantMessage("The action is recorded as receipt-1.");
        },
      ]);
      const replacement = owner();
      await runtime.onStart(replacement.instance, () => undefined);
      await runtime.drainSubmissions(replacement.instance);
      await Promise.all(replacement.fibers);
      expect(
        await stores.submissionStore.getSubmission("running")
      ).toMatchObject({ status: "settled" });
      expect(
        (await stores.submissionStore.getSubmission("running"))?.error
      ).toBeUndefined();
      expect(actionCount).toBe(1);
      const settled = await stores.submissionStore.getSubmission("running");
      releaseOldModel.resolve(fauxAssistantMessage("Late obsolete response."));
      await Promise.allSettled(first.fibers);
      expect(await stores.submissionStore.getSubmission("running")).toEqual(
        settled
      );
      expect(actionCount).toBe(1);
    } finally {
      releaseOldModel.resolve(fauxAssistantMessage("Late obsolete response."));
      await Promise.allSettled(first.fibers);
      await database.close?.();
    }
  });
  it("acknowledges durably before model execution and continues the same conversation on a replacement owner", async () => {
    const provider = fauxProvider({
      provider: "cf-continuity",
      tokensPerSecond: Number.POSITIVE_INFINITY,
    });
    setProvider(provider.provider);
    const model = provider.getModel();
    function Center() {
      useModel(`${model.provider}/${model.id}`);
      return "Keep the user's choices and continue their conversation.";
    }
    Center.durability = { maxAttempts: 5, timeoutMs: 0 };
    const database = sqlite();
    await database.migrate?.();
    const stores = await database.connect();
    const runtime = createCloudflareAgentRuntime({
      agents: [{ agent: Center, name: "center-agent-v2" }],
      createContext: ({ agentName, instance, request, submissionId }) =>
        createFlueContext({
          agentConfig: { resolveModel },
          agentName,
          env: {},
          id: instance.name,
          req: request,
          submissionId,
        }),
      runWithInstanceContext: (_instance, _agent, callback) => callback(),
    });
    function owner() {
      const fibers: Promise<void>[] = [];
      const instance = {
        ctx: { id: { toString: () => "same-durable-object" }, storage: {} },
        env: {},
        name: "session",
        schedule: async () => undefined,
        runFiber: (
          _name: string,
          callback: (context: {
            stash(snapshot: unknown): void;
          }) => Promise<void>
        ) => {
          const fiber = callback({ stash: () => undefined });
          fibers.push(fiber);
          return fiber;
        },
      };
      runtime.attach(instance, { agentName: "center-agent-v2", ...stores });
      return { instance, fibers };
    }
    const request = (submissionId: string, body: string) =>
      new Request("https://flue.internal/__flue/internal/dispatch", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          submissionId,
          agent: "center-agent-v2",
          id: "session",
          acceptedAt: new Date().toISOString(),
          message: { kind: "user", body },
        }),
      });
    try {
      provider.setResponses([fauxAssistantMessage("1. Northstar; 2. Cedar")]);
      const first = owner();
      await runtime.onStart(first.instance, () => undefined);
      const receipt = await runtime.onRequest(
        first.instance,
        request("one", "Give me two choices.")
      );
      expect(receipt?.ok).toBe(true);
      expect(await stores.submissionStore.getSubmission("one")).toMatchObject({
        status: "queued",
      });
      expect(provider.state.callCount).toBe(0);
      await runtime.drainSubmissions(first.instance);
      await Promise.all(first.fibers);
      expect(await stores.submissionStore.getSubmission("one")).toMatchObject({
        status: "settled",
      });

      provider.setResponses([
        (context) => {
          expect(JSON.stringify(context.messages)).toContain(
            "1. Northstar; 2. Cedar"
          );
          expect(JSON.stringify(context.messages)).toContain(
            "Choose the second one."
          );
          return fauxAssistantMessage("Cedar selected.");
        },
      ]);
      const replacement = owner();
      await runtime.onStart(replacement.instance, () => undefined);
      const second = await runtime.onRequest(
        replacement.instance,
        request("two", "Choose the second one.")
      );
      expect(second?.ok).toBe(true);
      await runtime.drainSubmissions(replacement.instance);
      await Promise.all(replacement.fibers);
      expect(await stores.submissionStore.getSubmission("two")).toMatchObject({
        status: "settled",
      });
      expect(
        (await stores.submissionStore.getSubmission("two"))?.error
      ).toBeUndefined();
      expect(provider.state.callCount).toBe(2);
    } finally {
      await database.close?.();
    }
  });
});
