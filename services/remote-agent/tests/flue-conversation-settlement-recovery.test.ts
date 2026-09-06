import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai";
import { init, instrument, observe, useModel } from "@flue/runtime";
import { sqlite, start } from "@flue/runtime/node";
import { expect, it, vi } from "vitest";
import {
  getRemoteAgentExecutionSubmissionId,
  REMOTE_AGENT_EXECUTION_INSTRUMENTATION,
  registerRemoteAgentExecutionPreparation,
  requireRemoteAgentExecutionResources,
} from "../flue-adapter/execution-context";

it("repairs an interrupted assistant stream before continuing this session", async () => {
  const directory = await mkdtemp(join(tmpdir(), "flue-stream-recovery-"));
  const database = join(directory, "session.sqlite");
  const provider = fauxProvider({
    provider: "stream-recovery",
    tokensPerSecond: 20,
  });
  const model = provider.getModel();
  const disposeInstrumentation = instrument(
    REMOTE_AGENT_EXECUTION_INSTRUMENTATION
  );
  const restorePreparation = registerRemoteAgentExecutionPreparation(() => {
    const submissionId = getRemoteAgentExecutionSubmissionId();
    expect(submissionId).not.toBeNull();
    return Promise.resolve({ submissionId });
  });
  function Center() {
    const resources = requireRemoteAgentExecutionResources<{
      submissionId: string;
    }>();
    expect(resources.submissionId).toBe(getRemoteAgentExecutionSubmissionId());
    useModel(`${model.provider}/${model.id}`);
    return "Keep the user's exact choices across an interrupted response.";
  }
  Center.durability = { maxAttempts: 5, timeoutMs: 0 };
  const streamed = Promise.withResolvers<void>();
  const realNow = Date.now.bind(Date);
  const clock = vi.spyOn(Date, "now");
  const unsubscribe = observe((event) => {
    if (event.type === "text_delta") {
      streamed.resolve();
    }
  });
  provider.setResponses([
    fauxAssistantMessage("This is a partial answer. ".repeat(100)),
  ]);
  let runtime = await start({
    agents: [Center],
    db: sqlite(database),
    providers: [provider.provider],
  });
  try {
    const first = init(Center, { id: "same-session" });
    const receipt = await first.dispatch(
      "Remember these choices: first Northstar, second Cedar."
    );
    await streamed.promise;
    await runtime.stop();
    // A replacement Node coordinator can reclaim only an expired owner lease.
    clock.mockImplementation(() => realNow() + 120_000);
    provider.setResponses([
      (context) => {
        expect(JSON.stringify(context.messages)).toContain("second Cedar");
        return fauxAssistantMessage("Cedar.");
      },
    ]);
    runtime = await start({
      agents: [Center],
      db: sqlite(database),
      providers: [provider.provider],
    });
    const replacement = init(Center, { id: "same-session" });
    expect((await replacement.read(receipt)).text).toContain("Cedar");
    provider.setResponses([
      (context) => {
        expect(JSON.stringify(context.messages)).toContain("second Cedar");
        return fauxAssistantMessage("Cedar selected.");
      },
    ]);
    expect(
      (
        await replacement.read(
          await replacement.dispatch("Choose the second one.")
        )
      ).text
    ).toContain("Cedar");
  } finally {
    unsubscribe();
    await runtime.stop();
    clock.mockRestore();
    restorePreparation();
    await disposeInstrumentation();
    await rm(directory, { recursive: true, force: true });
  }
});
