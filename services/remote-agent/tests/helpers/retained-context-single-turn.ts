import {
  type FauxResponseFactory,
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
  type Provider,
} from "@earendil-works/pi-ai";
import { defineTool, init, useModel, useTool } from "@flue/runtime";
import { sqlite, start } from "@flue/runtime/node";
import { type GenericSchema, number, object, string } from "valibot";
import { toFlueJsonValue } from "../../flue-adapter/tool-execution";
import {
  QUESTION,
  retainedContextScenario,
} from "./retained-context-evaluation";

/** All effects, recovery references and compactions stay in ONE Flue submission. */
export async function runRetainedContextSingleTurn(input: {
  database: string;
  enabled: boolean;
  summaryModel: string;
  continuation: FauxResponseFactory;
  providers?: Provider[];
}) {
  const scenario = await retainedContextScenario();
  const outputs = scenario.context.messages.filter(
    (message) => message.role === "toolResult"
  );
  const driver = fauxProvider({
    provider: "retained-single-turn",
    tokensPerSecond: Number.POSITIVE_INFINITY,
  });
  const model = driver.getModel();
  const writes: number[] = [],
    observations: number[] = [];
  let duplicateAttempt = false;
  let observationCursor = "start";
  const write = defineTool({
    name: "archive_write",
    description: "Complete one archive write. Never repeat a completed index.",
    input: object({ index: number() }),
    run: ({ data: { index } }) => {
      if (writes.includes(index)) {
        duplicateAttempt = true;
        throw new Error("Duplicate write");
      }
      const output = outputs[index]?.content[0];
      if (output?.type !== "text") {
        throw new Error("Unknown write");
      }
      writes.push(index);
      return { output: JSON.parse(output.text) };
    },
  });
  const observation = defineTool({
    name: "read_observation",
    description:
      "Read eight observation pages sequentially. Start with cursor 'start'. Use the returned nextCursor for the next call. Do not call in parallel or repeat a page. A null nextCursor means complete.",
    input: object({ cursor: string() }),
    run: ({ data: { cursor } }) => {
      const index = observations.length;
      if (cursor !== observationCursor || index > 7) {
        throw new Error("Unexpected observation cursor");
      }
      observations.push(index);
      observationCursor = `page-${crypto.randomUUID()}`;
      // Below the presentation cap and without a retained reference: the reducer
      // must keep it, forcing real summaries even in the enabled variant.
      return {
        output: {
          index,
          code: `OBS-${index}-VERIFIED`,
          nextCursor: index < 7 ? observationCursor : null,
          text: "Unchanged observation. ".repeat(1250),
        },
      };
    },
  });
  const read = defineTool({
    name: scenario.read.name,
    description: scenario.read.description,
    input: scenario.read.input as GenericSchema<Record<string, unknown>>,
    run: async ({ data }) => ({
      output: toFlueJsonValue(await scenario.read.execute(data)),
    }),
  });
  function SingleTurn() {
    useModel(`${model.provider}/${model.id}`, {
      compaction: {
        workingContextTokens: 20_000,
        workingContextHeadroomTokens: 4000,
        keepRecentTokens: 8000,
        maxSummaryTokens: 4096,
        model: input.summaryModel,
        ...(input.enabled ? { reduceToolResultPreviews: scenario.reduce } : {}),
      },
    });
    useTool(write);
    useTool(observation);
    useTool(read);
    return scenario.context.systemPrompt ?? "";
  }
  driver.setResponses([
    ...Array.from({ length: 8 }, (_, index) =>
      fauxAssistantMessage(fauxToolCall("archive_write", { index }), {
        stopReason: "toolUse",
      })
    ),
    ...Array.from({ length: 32 }, () => input.continuation),
  ]);
  const runtime = await start({
    agents: [SingleTurn],
    providers: [driver.provider, ...(input.providers ?? [])],
    db: sqlite(input.database),
  });
  try {
    const agent = init(SingleTurn, { id: "single-turn" });
    const result = await agent.read(
      await agent.dispatch(
        `Archive eight items (0 through 7) once. Then read observations 0 through 7 once each in ascending order. After all work completes, ${QUESTION} Also include observationCount (number), firstObservationCode and lastObservationCode. Earlier plan: owner Maya, USD 420. Final correction: owner Nora, budget USD 390. Deployment is NOT authorized. Current corrections override the earlier plan.`
      )
    );
    return { answer: result.text, writes, observations, duplicateAttempt };
  } finally {
    await runtime.stop();
  }
}
