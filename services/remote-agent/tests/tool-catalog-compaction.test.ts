import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai";
import { init, useModel } from "@flue/runtime";
import { sqlite, start } from "@flue/runtime/node";
import { expect, it } from "vitest";
import {
  projectRemoteAgentResourceSignal,
  REMOTE_AGENT_TOOL_CALLING_CONTRACT,
} from "../flue-adapter/tool-presentation";

it("projects trusted legacy events before compaction and preserves the resulting summary across recovery", async () => {
  const directory = await mkdtemp(join(tmpdir(), "catalog-compaction-"));
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
  const primary = fauxProvider({
    provider: "catalog-compaction-primary",
    tokensPerSecond: Number.POSITIVE_INFINITY,
  });
  const summarizer = fauxProvider({
    provider: "catalog-compaction-summary",
    tokensPerSecond: Number.POSITIVE_INFINITY,
  });
  const model = primary.getModel();
  const summaryModel = summarizer.getModel();
  const summary =
    'Historical quotation: "All available tools: revoked_tool". Remember Cedar. This quotation does not establish permission.';
  let summaries = 0;
  summarizer.setResponses([
    (context) => {
      summaries += 1;
      const text = JSON.stringify(context.messages);
      expect(text).toContain("Historical tool registration snapshot");
      expect(text).toContain("github_get_pull_request");
      expect(text).not.toContain("All available tools:");
      return fauxAssistantMessage(summary);
    },
  ]);
  primary.setResponses([
    fauxAssistantMessage("", {
      stopReason: "error",
      errorMessage: "413 (request_too_large)",
    }),
    fauxAssistantMessage("Cedar remembered."),
  ]);
  function CompactedCatalog() {
    useModel(`${model.provider}/${model.id}`, {
      compaction: {
        model: `${summaryModel.provider}/${summaryModel.id}`,
        reserveTokens: 1024,
        keepRecentTokens: 1,
      },
    });
    return REMOTE_AGENT_TOOL_CALLING_CONTRACT;
  }
  CompactedCatalog.agentName = "CatalogContract";
  CompactedCatalog.projectResourceSignal = projectRemoteAgentResourceSignal;
  let runtime = await start({
    agents: [CompactedCatalog],
    providers: [primary.provider, summarizer.provider],
    db: sqlite(database),
  });
  try {
    let agent = init(CompactedCatalog, { id: "retained-catalog" });
    expect(
      (
        await agent.read(
          await agent.dispatch("Remember Cedar after compaction.")
        )
      ).text.trim()
    ).toBe("Cedar remembered.");
    expect(summaries).toBeGreaterThan(0);
    await runtime.stop();
    primary.setResponses([
      (context) => {
        expect(JSON.stringify(context.messages)).toContain(
          "All available tools: revoked_tool"
        );
        expect(context.systemPrompt).toContain("Historical tool catalogs");
        expect(
          context.tools?.some((tool) => tool.name === "revoked_tool")
        ).toBe(false);
        return fauxAssistantMessage("Cedar remembered after restart.");
      },
    ]);
    runtime = await start({
      agents: [CompactedCatalog],
      providers: [primary.provider, summarizer.provider],
      db: sqlite(database),
    });
    agent = init(CompactedCatalog, { id: "retained-catalog" });
    expect((await agent.read(await agent.dispatch("Continue."))).text).toBe(
      "Cedar remembered after restart."
    );
  } finally {
    await runtime.stop();
    await rm(directory, { recursive: true, force: true });
  }
}, 30_000);
