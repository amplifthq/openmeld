import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
  type Provider,
} from "@earendil-works/pi-ai";
import { defineTool, init, useModel, useTool } from "@flue/runtime";
import { sqlite, start } from "@flue/runtime/node";
import { type GenericSchema, number, object } from "valibot";
import { toFlueJsonValue } from "../../flue-adapter/tool-execution";
import { retainedContextScenario } from "./retained-context-evaluation";

/** Public Flue dispatch with seeded write receipts; measured work uses the given model. */
export async function startRetainedContextRun(input: {
  database: string;
  model: string;
  enabled: boolean;
  providers?: Provider[];
  summaryModel?: string;
}) {
  const scenario = await retainedContextScenario();
  const outputs = scenario.context.messages.filter(
    (message) => message.role === "toolResult"
  );
  const seed = fauxProvider({
    provider: "retained-context-seed",
    tokensPerSecond: Number.POSITIVE_INFINITY,
  });
  const seedModel = seed.getModel();
  let seeding = true;
  let bounded = true;
  const writes: number[] = [];
  const writeAttempts: number[] = [];
  const write = defineTool({
    name: "archive_write",
    description: "Complete one archive write. Never repeat a completed index.",
    input: object({ index: number() }),
    run: ({ data: { index } }) => {
      writeAttempts.push(index);
      if (writes.includes(index)) {
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
  const read = defineTool({
    name: scenario.read.name,
    description: scenario.read.description,
    input: scenario.read.input as GenericSchema<Record<string, unknown>>,
    run: async ({ data: args }) => ({
      output: toFlueJsonValue(await scenario.read.execute(args)),
    }),
  });
  function RetainedContext() {
    useModel(seeding ? `${seedModel.provider}/${seedModel.id}` : input.model, {
      compaction:
        seeding || !bounded
          ? false
          : {
              workingContextTokens: 20_000,
              workingContextHeadroomTokens: 4000,
              keepRecentTokens: 8000,
              maxSummaryTokens: 4096,
              ...(input.summaryModel ? { model: input.summaryModel } : {}),
              ...(input.enabled
                ? { reduceToolResultPreviews: scenario.reduce }
                : {}),
            },
    });
    useTool(write);
    useTool(read);
    return scenario.context.systemPrompt ?? "";
  }
  const runtime = await start({
    agents: [RetainedContext],
    providers: [seed.provider, ...(input.providers ?? [])],
    db: sqlite(input.database),
  });
  const agent = init(RetainedContext, { id: "evaluation" });
  try {
    seed.setResponses([
      ...Array.from({ length: 8 }, (_, index) =>
        fauxAssistantMessage(fauxToolCall("archive_write", { index }), {
          stopReason: "toolUse",
        })
      ),
      fauxAssistantMessage("Eight writes completed. No deployment authorized."),
    ]);
    await agent.read(
      await agent.dispatch(
        "Archive eight items once. Owner Maya, budget USD 420. Deployment is NOT authorized."
      )
    );
    seeding = false;
    return {
      agent,
      scenario,
      writes,
      writeAttempts,
      stop: () => runtime.stop(),
      setBudget: (value: boolean) => {
        bounded = value;
      },
    };
  } catch (error) {
    await runtime.stop();
    throw error;
  }
}
