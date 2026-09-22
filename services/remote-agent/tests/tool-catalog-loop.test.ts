import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import { init, useModel, useTool } from "@flue/runtime";
import { sqlite, start } from "@flue/runtime/node";
import { expect, it, vi } from "vitest";
import { rpcCenterAgentReadAuditJournal } from "../../core/src/rpc/methods";
import { registerRemoteAgentCloudflareProvider } from "../flue-adapter/model";
import {
  projectRemoteAgentResourceSignal,
  REMOTE_AGENT_TOOL_CALLING_CONTRACT,
} from "../flue-adapter/tool-presentation";
import { getRemoteAgentFlueTools } from "../flue-adapter/tools";
import {
  createEvidenceFixture,
  EVIDENCE_SPACE_ID,
  EVIDENCE_SUBMISSION_ID,
} from "./center-agent-evidence.test-support";
import {
  TEST_CENTER_AGENT_GLM_DEFAULT_MODEL_ROUTE,
  TEST_NOW_MS,
} from "./fixtures";
import { NODE_CODE_MODE_RUNTIME } from "./node-code-mode-runtime";

const ACTIVITY = "openmeld_read_center_agent_activity";
const code = (limit: number) =>
  `async () => codemode.${ACTIVITY}({limit:${limit}})`;
const call = (name: string, args: Record<string, unknown>) =>
  fauxAssistantMessage(fauxToolCall(name, args), { stopReason: "toolUse" });

it("delivers database-backed results through discovery, schemas, Code Mode and the real Flue loop, then rejects revoked authority", async () => {
  const f = await createEvidenceFixture();
  const calls: number[] = [];
  for (const [index, id] of ["cedar-action", "birch-action"].entries()) {
    f.harness.run({
      sql: "INSERT INTO center_agent_audit_journal (id, organization_id, actor_profile_id, action, resource_type, resource_id, source_space_id, created_at) VALUES (?, ?, ?, 'create_space', 'space', ?, ?, ?)",
      params: [
        id,
        f.request.organizationId,
        f.request.agentProfileId,
        EVIDENCE_SPACE_ID,
        EVIDENCE_SPACE_ID,
        TEST_NOW_MS + index,
      ],
    });
  }
  const catalog = await getRemoteAgentFlueTools({
    coreWorker: {
      centerAgentReadAuditJournal: async (input) => {
        const result = await rpcCenterAgentReadAuditJournal(f.env, input);
        calls.push(input.limit ?? 0);
        return result;
      },
    },
    storage: f.storage,
    submissionId: EVIDENCE_SUBMISSION_ID,
    turnEnvelope: f.request.turnEnvelope,
    codeModeRuntime: NODE_CODE_MODE_RUNTIME,
    env: { LOADER: {} as WorkerLoader },
    callLimit: 20,
  });
  const provider = fauxProvider({
    provider: "catalog-loop",
    tokensPerSecond: Number.POSITIVE_INFINITY,
  });
  const model = provider.getModel();
  let modelSpecifier = `${model.provider}/${model.id}`;
  function CatalogLoop() {
    useModel(modelSpecifier, { compaction: false });
    for (const tool of catalog.tools) {
      useTool(tool);
    }
    return `You are assisting the verified member in this isolated test conversation. Use the current authorized journal to answer the request. ${REMOTE_AGENT_TOOL_CALLING_CONTRACT}`;
  }
  CatalogLoop.projectResourceSignal = projectRemoteAgentResourceSignal;
  CatalogLoop.agentName = "CatalogContract";
  const directory = await mkdtemp(join(tmpdir(), "catalog-loop-"));
  const database = join(directory, "runtime.sqlite");
  await writeFile(
    database,
    gunzipSync(
      await readFile(
        new URL(
          "./fixtures/flue-2.0.3-legacy-catalog.sqlite.gz",
          import.meta.url
        )
      )
    )
  );
  const live = process.env.CENTER_AGENT_CATALOG_LIVE === "1";
  const trace: unknown[] = [];
  if (live) {
    const realFetch = globalThis.fetch;
    vi.spyOn(globalThis, "fetch").mockImplementation(
      async (request, options) => {
        const outgoing = new Request(request, options);
        if (!outgoing.url.startsWith("https://gateway.ai.cloudflare.com/")) {
          throw new Error(
            "This isolated validation only allows model traffic through the configured Gateway."
          );
        }
        const payload = (await outgoing.json()) as Record<string, unknown>;
        payload.provider = {
          only: [process.env.CENTER_AGENT_CATALOG_PROVIDER ?? "Together"],
          allow_fallbacks: false,
        };
        const headers = new Headers(outgoing.headers);
        headers.set("cf-aig-collect-log", "false");
        headers.set("cf-aig-skip-cache", "true");
        const response = await realFetch(
          new Request(outgoing.url, {
            method: "POST",
            headers,
            body: JSON.stringify(payload),
          })
        );
        const body = await response.clone().text();
        const chunks = body
          .split("\n")
          .filter((line) => line.startsWith("data: {"))
          .map(
            (line) =>
              JSON.parse(line.slice(6)) as {
                id?: string;
                provider?: string;
                choices?: {
                  finish_reason?: string;
                  delta?: { tool_calls?: unknown[] };
                }[];
              }
          );
        trace.push({
          status: response.status,
          provider: chunks.find((chunk) => chunk.provider)?.provider ?? null,
          responseId: chunks.find((chunk) => chunk.id)?.id ?? null,
          finishes: chunks.flatMap(
            (chunk) =>
              chunk.choices
                ?.map((choice) => choice.finish_reason)
                .filter(Boolean) ?? []
          ),
          toolCalls: chunks.flatMap(
            (chunk) =>
              chunk.choices?.flatMap(
                (choice) => choice.delta?.tool_calls ?? []
              ) ?? []
          ),
        });
        return response;
      }
    );
  }
  const runtime = await start({
    agents: [CatalogLoop],
    providers: live ? [] : [provider.provider],
    db: sqlite(database),
  });
  try {
    if (live) {
      modelSpecifier = (
        await registerRemoteAgentCloudflareProvider({
          env: {
            OPENMELD_REMOTE_AGENT_AI_GATEWAY_ACCOUNT_ID:
              process.env.OPENMELD_REMOTE_AGENT_AI_GATEWAY_ACCOUNT_ID,
            OPENMELD_REMOTE_AGENT_AI_GATEWAY_ID:
              process.env.OPENMELD_REMOTE_AGENT_AI_GATEWAY_ID,
            CLOUDFLARE_OPENMELD_AI_GATEWAY_TOKEN:
              process.env.CLOUDFLARE_OPENMELD_AI_GATEWAY_TOKEN,
            OPENMELD_REMOTE_AGENT_OPENROUTER_BYOK_ALIAS: "openrouter",
          },
          modelRoute: TEST_CENTER_AGENT_GLM_DEFAULT_MODEL_ROUTE,
          organizationId: null,
        })
      ).modelSpecifier;
    } else {
      provider.setResponses([
        call("openmeld_search_capabilities", {
          query: "Center Agent organization activity journal",
          limit: 5,
        }),
        call("openmeld_describe_capabilities", { names: [ACTIVITY] }),
        call("codemode", { code: code(1) }),
        call("codemode", { code: code(2) }),
        (context) => {
          const results = context.messages.filter(
            (message) => message.role === "toolResult"
          );
          expect(results).toHaveLength(4);
          expect(JSON.stringify(results.at(-1))).toContain("cedar-action");
          expect(JSON.stringify(results.at(-1))).toContain("birch-action");
          return fauxAssistantMessage(
            "birch-action: create_space; cedar-action: create_space. These are the two most recent recorded actions, not complete history."
          );
        },
      ]);
    }
    const agent = init(CatalogLoop, { id: "retained-catalog" });
    const receipt = await agent.dispatch(
      "请通过能力发现读取最近两条 Center Agent 操作记录，给出准确的记录 ID 和操作类型。先用 limit=1 检查最新一条，再读取两条，确认顺序。只读取，不修改任何数据。"
    );
    const answer = await agent.read(receipt);
    expect(answer.text).toContain("cedar-action");
    expect(answer.text).toContain("birch-action");
    expect(answer.text).toContain("create_space");
    expect(calls).toEqual([1, 2]);
    expect((await agent.read(receipt)).text).toBe(answer.text);
    expect(f.sourceReads.length).toBeGreaterThan(0);
    if (live) {
      console.info(
        "CATALOG_LIVE_RESULT",
        JSON.stringify({
          model: modelSpecifier,
          calls,
          answer: answer.text,
          submissionId: receipt.submissionId,
          trace,
        })
      );
    }

    // Ordinary questions may finish with zero tools; this fix must not create
    // a blanket retry or forced-tool policy.
    if (!live) {
      provider.setResponses([fauxAssistantMessage("你好")]);
    }
    const traceBeforeQuestion = trace.length;
    const plainAnswer = await agent.read(
      await agent.dispatch(
        "把 Hello 翻译成中文，只回答译文。这不是查询操作记录的请求。"
      )
    );
    expect(plainAnswer.text).toContain("你好");
    expect(calls).toEqual([1, 2]);
    if (live) {
      const questionTrace = trace.slice(traceBeforeQuestion);
      expect(questionTrace.length).toBeGreaterThan(0);
      for (const request of questionTrace) {
        expect(request).toMatchObject({ status: 200, toolCalls: [] });
      }
      expect(questionTrace.at(-1)).toMatchObject({
        finishes: expect.arrayContaining(["stop"]),
      });
      console.info(
        "CATALOG_LIVE_QA",
        JSON.stringify({ answer: plainAnswer.text, trace: questionTrace })
      );
    }

    // Keep the original frozen catalog and prior successful results. Revoking
    // membership must still fail in the real Core owner on the next invocation.
    f.harness.run({
      sql: "DELETE FROM members WHERE id = ?",
      params: [f.speaker.id],
    });
    const codeMode = catalog.tools.find((tool) => tool.name === "codemode");
    if (!codeMode) {
      throw new Error("Missing Code Mode.");
    }
    await expect(
      codeMode.run({
        data: { code: code(2) },
        log: console,
        toolCallId: "revoked",
      })
    ).rejects.toThrow();
    expect(calls).toEqual([1, 2]);
    await expect(
      codeMode.run({
        data: {
          code: "async () => codemode.github_get_pull_request({owner:'example',repo:'example',pullNumber:1})",
        },
        log: console,
        toolCallId: "missing-github-actor",
      })
    ).rejects.toThrow("githubActor");
  } finally {
    if (live) {
      console.info("CATALOG_LIVE_TRACE", JSON.stringify(trace));
    }
    vi.restoreAllMocks();
    await runtime.stop();
    await rm(directory, { recursive: true, force: true });
    f.harness.close();
  }
}, 180_000);

import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
