import type { ToolDefinition } from "@flue/runtime";
import { HOSTED_PUBLIC_PROGRESS_TOOL_NAME } from "./public-progress";

export function useInteractiveResponse(input: {
  getInputId: () => string | null;
  getAcceptedResponseInputId: () => string | null;
  tools: ToolDefinition[];
}): { tools: ToolDefinition[]; ready: boolean } {
  const inputId = input.getInputId();
  const ready = !inputId || input.getAcceptedResponseInputId() === inputId;
  if (ready) {
    return { tools: input.tools, ready };
  }
  const progress = input.tools.find(
    (tool) => tool.name === HOSTED_PUBLIC_PROGRESS_TOOL_NAME
  );
  if (!progress) {
    throw new Error("remote_agent.interactive_response_unavailable");
  }
  // Do not expose work, discovery, Code Mode or Skills until Core accepts the
  // user-facing response. This keeps one submission and its existing authority.
  // Text and progress share the publisher's durable Core acknowledgement;
  // generated text or a successful tool invocation alone cannot unlock work.
  const responseTool: ToolDefinition = {
    ...progress,
    run: async (context) => {
      const responseInputId = input.getInputId();
      const result = await progress.run(context);
      if (
        result &&
        typeof result === "object" &&
        "output" in result &&
        result.output &&
        typeof result.output === "object" &&
        "shown" in result.output &&
        result.output.shown === true &&
        responseInputId === input.getInputId() &&
        input.getAcceptedResponseInputId() === responseInputId
      ) {
        return {
          ...result,
          output: {
            ...result.output,
            nextAction: "continue_existing_work",
            detail:
              "Your response was published. Work tools are available on the next turn. The current execution and original commands remain active; continue using their existing references.",
          },
        };
      }
      return result ?? {};
    },
  };
  return {
    ready: false,
    tools: [responseTool],
  };
}
