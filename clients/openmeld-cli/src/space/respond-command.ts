import { isCancel, select } from "@clack/prompts";
import { agentInteractionResponseSchema } from "@openmeld/schemas";
import type {
  AgentInteractionRequest,
  AgentInteractionResponse,
} from "@openmeld/schemas/types";
import { buildCommandAuthenticationPromptMessage } from "../auth/command-auth";
import { buildOpenMeldRequestContextFromProfile } from "../config/openmeld-request-context";
import { createCliSpaceApi } from "./cli-space-api";
import {
  assertValidSpaceIdTarget,
  prepareAuthenticatedSpaceCommandContext,
  resolveOpenMeldProfileForSpaceCommand,
} from "./command-context";
import {
  runSpaceReadWithPasswordRetry,
  runSpaceWriteWithPasswordRetry,
} from "./password-flow";

export async function runSpaceRespond(input: {
  space: string;
  profile?: string;
  baseUrl?: string;
  password?: string;
  view?: string;
  execution?: string;
  interaction?: string;
  response?: string;
  entryChecksHandled?: boolean;
}): Promise<void> {
  const context = await prepareAuthenticatedSpaceCommandContext({
    ...input,
    promptMessage: buildCommandAuthenticationPromptMessage(
      "answering a task’s request"
    ),
  });
  if (context.status === "cancelled") {
    return;
  }
  const { runtime, presenter, interactive, baseUrl } = context;
  const canPrompt = interactive && runtime.resolvedView === "human";
  assertValidSpaceIdTarget({
    space: input.space,
    resolvedView: runtime.resolvedView,
  });
  const openMeldProfile = await resolveOpenMeldProfileForSpaceCommand({
    openMeldProfileId: input.profile,
    resolvedView: runtime.resolvedView,
    interactive,
  });
  const requestContext = buildOpenMeldRequestContextFromProfile({
    openMeldProfile,
  });
  const api = createCliSpaceApi(baseUrl);
  const read = await runSpaceReadWithPasswordRetry({
    initialPassword: input.password,
    interactive: canPrompt,
    presenter,
    execute: (password) =>
      api.getActiveWakeProgress({
        spaceId: input.space,
        requestContext,
        spacePassword: password,
        includeSourceContext: true,
      }),
  });
  if (read.status === "cancelled") {
    return;
  }
  const pending = read.result.items.filter(
    (item) =>
      item.pendingInteraction?.canRespond &&
      item.pendingInteraction.request &&
      (!input.execution ||
        item.runtimeCoordinatorExecutionId === input.execution) &&
      (!input.interaction ||
        item.pendingInteraction.interactionId === input.interaction)
  );
  if (!pending.length) {
    presenter.line({
      code: "space.respond.not_pending",
      text: "There is no request for you to answer here. It may already be resolved, or need the Agent owner’s response.",
    });
    return;
  }
  if (input.response && !(input.execution && input.interaction)) {
    throw new Error(
      "Include --execution and --interaction with --response so the answer reaches the exact request."
    );
  }
  if (!(input.response || canPrompt)) {
    presenter.data({
      code: "space.respond.needs_action",
      payload: {
        status: "needs_action",
        requests: pending.map((item) => ({
          execution: item.runtimeCoordinatorExecutionId,
          interaction: item.pendingInteraction?.interactionId,
          targetProfileId: item.targetProfileId,
          request: item.pendingInteraction?.request,
        })),
        nextAction:
          "Choose an offered answer, then run space respond with --execution, --interaction, and --response containing the response JSON. No answer has been submitted.",
      },
    });
    return;
  }
  const selected =
    pending.length === 1 ? pending[0] : await choosePendingTask(pending);
  if (
    !(
      selected?.runtimeCoordinatorExecutionId &&
      selected.pendingInteraction?.request
    )
  ) {
    return;
  }
  const runtimeCoordinatorExecutionId = selected.runtimeCoordinatorExecutionId;
  const interactionId = selected.pendingInteraction.interactionId;
  if (!input.response) {
    const request = selected.pendingInteraction.request;
    presenter.line({
      code: "space.respond.question",
      text: [request.title, request.description].filter(Boolean).join("\n"),
    });
  }
  const response = input.response
    ? parseResponse(input.response)
    : await chooseQuestionResponse(selected.pendingInteraction.request);
  if (!response) {
    return;
  }
  const result = await runSpaceWriteWithPasswordRetry({
    initialPassword: read.password,
    interactive: canPrompt,
    presenter,
    execute: (password) =>
      api.respondToAgentInteraction({
        spaceId: input.space,
        requestContext,
        spacePassword: password,
        body: { runtimeCoordinatorExecutionId, interactionId, response },
      }),
  });
  if (result.status === "cancelled") {
    return;
  }
  presenter.data({ code: "space.respond", payload: result.result });
  if (!result.result.ok) {
    presenter.line({
      code: "space.respond.rejected",
      text: result.result.message,
    });
    return;
  }
  presenter.line({
    code: "space.respond.sent",
    text:
      result.result.status === "already_resolved"
        ? "This request is already resolved. Check the task for its result."
        : "Response sent. Check this task for its final result.",
  });
}

function parseResponse(value: string): AgentInteractionResponse {
  const parsed = agentInteractionResponseSchema.safeParse(JSON.parse(value));
  if (!parsed.success) {
    throw new Error(
      "The response does not match an available answer. Read the pending request and try again."
    );
  }
  return parsed.data;
}

async function choosePendingTask<
  T extends {
    targetLabel: string;
  },
>(items: T[]): Promise<T | undefined> {
  const index = await select({
    message: "Which task needs your response?",
    options: items.map((item, index) => ({
      value: index,
      label: item.targetLabel,
    })),
  });
  return isCancel(index) ? undefined : items[index];
}

async function chooseQuestionResponse(
  request: AgentInteractionRequest
): Promise<AgentInteractionResponse | null> {
  if (
    request.kind !== "question" ||
    request.questions.some(
      (question) => question.multiple || question.allowOther
    )
  ) {
    throw new Error(
      "Open this request in the Space to respond, or use --response with its response JSON."
    );
  }
  const answers: Extract<
    AgentInteractionResponse,
    { kind: "question" }
  >["answers"] = [];
  for (const question of request.questions) {
    const value = await select({
      message: question.prompt,
      options: question.options.map((option) => ({
        value: option.optionId,
        label: option.label,
        hint: option.description ?? undefined,
      })),
    });
    if (isCancel(value)) {
      return null;
    }
    answers.push({ questionId: question.questionId, values: [value] });
  }
  return { kind: "question", answers };
}
