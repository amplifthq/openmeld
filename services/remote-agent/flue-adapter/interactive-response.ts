import type { ToolDefinition } from "@flue/runtime";
import { HOSTED_PUBLIC_PROGRESS_TOOL_NAME } from "./public-progress";

export function useInteractiveResponse(input: {
  getInputId: () => string | null;
  getAcceptedResponseInputId: () => string | null;
  tools: ToolDefinition[];
}): { tools: ToolDefinition[]; ready: boolean; instructions: string } {
  const inputId = input.getInputId();
  const ready = !inputId || input.getAcceptedResponseInputId() === inputId;
  if (ready) {
    return {
      tools: input.tools,
      ready,
      instructions: inputId
        ? "The current input's response has been published. The authorized work-tool catalog is available now; earlier resource-removal notices described only the response phase. Continue existing authorized work with its original command references. A check-in does not pause the task or require another user message to finish collecting results."
        : "",
    };
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
    description: `Publish your initial response so this request can continue with its authorized work tools. During this response phase, work tools and capability discovery are temporarily hidden. If the request needs files, research, verification or other tool use, call this tool with a brief next action in the user's language, then continue after publication is confirmed. The current tool list does not establish that those capabilities are unavailable. ${progress.description}`,
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
    instructions:
      "You are in the initial response phase, not the work phase. Work tools, capability discovery and Skills are temporarily hidden until OpenMeld confirms your response was published. This is not evidence of missing tools or denied access. If the request needs reading attachments, checking other replies, research, verification or any other tool use, first call openmeld_report_progress with a brief next action in the user's language. Then continue this same request with the authorized tools after publication is confirmed; do not ask the user to resend files or start another request merely because tools are hidden now. If the request is fully answerable from the evidence already in context, you may answer directly without tools. Keep existing commands and results; this phase does not end or restart the task.",
  };
}
