import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai";
import { expect, it } from "vitest";
import { ORIGINAL_CODE } from "./helpers/retained-context-evaluation";
import { startRetainedContextRun } from "./helpers/retained-context-runtime";

it.each([
  false,
  true,
])("reduces before summarizing, preserves originals and survives repeated compaction (enabled=%s)", async (enabled) => {
  const directory = await mkdtemp(join(tmpdir(), "retained-context-runtime-"));
  const work = fauxProvider({
    provider: "retained-work",
    tokensPerSecond: Number.POSITIVE_INFINITY,
  });
  const summary = fauxProvider({
    provider: "retained-summary",
    tokensPerSecond: Number.POSITIVE_INFINITY,
  });
  const model = work.getModel(),
    summarizer = summary.getModel();
  summary.setResponses(
    Array.from({ length: 10 }, () =>
      fauxAssistantMessage(
        "Current owner Nora, USD 390. No deployment permission. Eight archive writes completed; exact details remain in original retained output."
      )
    )
  );
  const run = await startRetainedContextRun({
    database: join(directory, "history.sqlite"),
    enabled,
    model: `${model.provider}/${model.id}`,
    summaryModel: `${summarizer.provider}/${summarizer.id}`,
    providers: [work.provider, summary.provider],
  });
  try {
    work.setResponses([
      (context) => {
        expect(JSON.stringify(context.messages)).toContain("owner Nora");
        if (enabled) {
          expect(JSON.stringify(context.messages)).not.toContain(ORIGINAL_CODE);
          expect(JSON.stringify(context.messages)).toContain("archive-0");
        }
        return fauxAssistantMessage("Current correction accepted.");
      },
    ]);
    await run.agent.read(
      await run.agent.dispatch(
        "Final correction: owner Nora, budget USD 390. Deployment remains unauthorized."
      )
    );
    expect(summary.state.callCount).toBe(enabled ? 0 : 1);
    if (enabled) {
      run.setBudget(false);
      work.setResponses([
        (context) => {
          expect(JSON.stringify(context.messages)).toContain(ORIGINAL_CODE);
          return fauxAssistantMessage("Canonical originals remain intact.");
        },
      ]);
      await run.agent.read(
        await run.agent.dispatch("Inspect the retained history.")
      );
      run.setBudget(true);
    }
    // Force genuine compaction even when previews alone can fit the first turn.
    work.setResponses(
      Array.from({ length: 3 }, () =>
        fauxAssistantMessage("Current correction retained.")
      )
    );
    for (let index = 0; index < 3; index++) {
      await run.agent.read(
        await run.agent.dispatch(
          `${"Archived observation. ".repeat(2300)} Current owner Nora, USD 390. No deployment permission.`
        )
      );
    }
    expect(summary.state.callCount).toBeGreaterThanOrEqual(2);
    expect(run.writes).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(run.writeAttempts).toEqual(run.writes);
    const list = (await run.scenario.read.execute({})) as {
      results: { resultId: string }[];
    };
    const found = await Promise.all(
      list.results.map(({ resultId }) =>
        run.scenario.read.execute({ resultId, query: ORIGINAL_CODE })
      )
    );
    expect(JSON.stringify(found)).toContain(ORIGINAL_CODE);
  } finally {
    await run.stop();
    await rm(directory, { recursive: true, force: true });
  }
});
