import {
  type AssistantMessage,
  type Context,
  type Model,
  type ToolCall,
  Type,
} from "@earendil-works/pi-ai";
import { complete } from "@earendil-works/pi-ai/compat";
import { getBuiltinModels } from "@earendil-works/pi-ai/providers/all";
import {
  remoteAgentTransientSlackContextRequestSchema,
  remoteAgentTransientSlackContextResponseSchema,
  remoteAgentTransientSlackSearchResponseSchema,
} from "@openmeld/schemas";
import type {
  RemoteAgentTransientSlackContextRequest,
  RemoteAgentTransientSlackContextResponse,
  RemoteAgentTransientSlackSearchRequest,
  RemoteAgentTransientSlackSearchResponse,
} from "@openmeld/schemas/types";
import {
  buildRemoteAgentZeroRetentionAiGatewayHeaders,
  prepareRemoteAgentZeroRetentionOpenRouterPayload,
  resolveRemoteAgentAiGatewayOpenRouterBaseUrl,
} from "./model";

const MAX_SEARCH_CALLS = 3;
const MAX_EVIDENCE_ITEMS = 30;
const MAX_EVIDENCE_ITEMS_PER_SEARCH = 12;
const TRANSIENT_SLACK_DECISION_TOOL = "choose_transient_slack_action";
const TRANSIENT_SLACK_SEARCH_TOOL = "search_slack_messages";

type ReasoningInput = Pick<
  RemoteAgentTransientSlackContextRequest,
  "organizationId" | "requestText" | "v"
> & {
  requester: Pick<
    RemoteAgentTransientSlackContextRequest["requester"],
    "displayName" | "slackUserId"
  >;
};

type CompleteTransientTurn = (context: Context) => Promise<AssistantMessage>;
type SearchTransientSlack = (input: {
  includeBots: boolean;
  query: string;
}) => Promise<RemoteAgentTransientSlackSearchResponse>;

type ResolvedTransientSlackToolCall =
  | { outcome: "pass_through" }
  | {
      includeBots: boolean;
      initialDecision: boolean;
      outcome: "search";
      query: string;
    };

export async function runTransientSlackContextReasoning(input: {
  complete: CompleteTransientTurn;
  input: ReasoningInput;
  search: SearchTransientSlack;
}): Promise<RemoteAgentTransientSlackContextResponse> {
  const context: Context = {
    messages: [
      {
        content: input.input.requestText,
        role: "user",
        timestamp: Date.now(),
      },
    ],
    systemPrompt: buildTransientSlackSystemPrompt(input.input),
    tools: [buildTransientSlackDecisionTool()],
  };
  let searchCalls = 0;
  let evidenceItems = 0;
  const seenPermalinks = new Set<string>();

  while (true) {
    const assistant = await input.complete(context);
    if (
      assistant.stopReason === "error" ||
      assistant.stopReason === "aborted"
    ) {
      throw new Error(
        `Transient Slack model ${assistant.stopReason}: ${assistant.errorMessage ?? "No provider error was returned."}`
      );
    }
    const toolCall = assistant.content.find(
      (part): part is ToolCall => part.type === "toolCall"
    );
    const text = assistant.content
      .flatMap((part) => (part.type === "text" ? [part.text] : []))
      .join("")
      .trim();

    if (!toolCall) {
      if (searchCalls === 0) {
        throw new Error(
          "Transient Slack reasoning must choose a transient Slack tool before answering."
        );
      }
      if (!text) {
        throw new Error("Transient Slack reasoning returned an empty answer.");
      }
      return remoteAgentTransientSlackContextResponseSchema.parse({
        outcome: "answered",
        text,
        v: 1,
      });
    }
    const resolvedToolCall = resolveTransientSlackToolCall({
      searchCalls,
      toolCall,
    });
    if (resolvedToolCall.outcome === "pass_through") {
      return { outcome: "pass_through", v: 1 };
    }
    if (searchCalls >= MAX_SEARCH_CALLS) {
      throw new Error("Slack search budget was exhausted.");
    }
    if (resolvedToolCall.initialDecision) {
      context.tools = [buildTransientSlackSearchTool()];
    }
    searchCalls += 1;
    const searchResult = await input.search({
      includeBots: resolvedToolCall.includeBots,
      query: resolvedToolCall.query,
    });
    const boundedResult = boundSearchEvidence({
      remainingItems: Math.min(
        MAX_EVIDENCE_ITEMS_PER_SEARCH,
        MAX_EVIDENCE_ITEMS - evidenceItems
      ),
      result: searchResult,
      seenPermalinks,
    });
    evidenceItems += boundedResult.evidenceItemCount;
    context.messages.push(assistant, {
      content: [
        {
          text: JSON.stringify(boundedResult.result),
          type: "text",
        },
      ],
      isError: boundedResult.result.status !== "found",
      role: "toolResult",
      timestamp: Date.now(),
      toolCallId: toolCall.id,
      toolName: toolCall.name,
    });
    closeTransientSlackSearchIfComplete({
      context,
      evidenceItems,
      searchCalls,
    });
  }
}

function buildTransientSlackDecisionTool() {
  return {
    description:
      "Choose whether this request needs transient public Slack evidence or should continue through the ordinary Center Agent conversation. The model owns this decision. When searching, provide the first focused query now.",
    name: TRANSIENT_SLACK_DECISION_TOOL,
    parameters: Type.Object({
      action: Type.Union([
        Type.Literal("search_slack_messages"),
        Type.Literal("continue_normal_conversation"),
      ]),
      includeBots: Type.Optional(Type.Boolean()),
      query: Type.Optional(Type.String({ maxLength: 500, minLength: 1 })),
    }),
  };
}

function buildTransientSlackSearchTool() {
  return {
    description:
      "Search public Slack messages visible to this requester. Use focused natural-language queries and refine them from evidence when useful.",
    name: TRANSIENT_SLACK_SEARCH_TOOL,
    parameters: Type.Object({
      includeBots: Type.Optional(Type.Boolean()),
      query: Type.String({ maxLength: 500, minLength: 1 }),
    }),
  };
}

function resolveTransientSlackToolCall(input: {
  searchCalls: number;
  toolCall: ToolCall;
}): ResolvedTransientSlackToolCall {
  if (input.toolCall.name === TRANSIENT_SLACK_DECISION_TOOL) {
    if (input.searchCalls > 0) {
      throw new Error("Transient Slack routing was already decided.");
    }
    const action = normalizeToolString(input.toolCall.arguments.action);
    if (action === "continue_normal_conversation") {
      return { outcome: "pass_through" };
    }
    if (action !== "search_slack_messages") {
      throw new Error("Transient Slack routing returned an invalid action.");
    }
    return resolveTransientSlackSearchToolCall(input.toolCall, true);
  }
  if (input.toolCall.name === TRANSIENT_SLACK_SEARCH_TOOL) {
    return resolveTransientSlackSearchToolCall(input.toolCall, false);
  }
  throw new Error(`Unsupported transient Slack tool: ${input.toolCall.name}`);
}

function resolveTransientSlackSearchToolCall(
  toolCall: ToolCall,
  initialDecision: boolean
): ResolvedTransientSlackToolCall {
  const query = normalizeToolString(toolCall.arguments.query);
  if (!query) {
    throw new Error("Slack search requires a non-empty query.");
  }
  return {
    includeBots: toolCall.arguments.includeBots === true,
    initialDecision,
    outcome: "search",
    query,
  };
}

export async function runRemoteAgentTransientSlackContext(input: {
  env: {
    CLOUDFLARE_OPENMELD_AI_GATEWAY_TOKEN?: string;
    OPENMELD_CORE_WORKER?: {
      centerAgentReadTransientSlackSearch?(
        request: RemoteAgentTransientSlackSearchRequest
      ): Promise<unknown>;
    };
    OPENMELD_REMOTE_AGENT_AI_GATEWAY_ACCOUNT_ID?: string;
    OPENMELD_REMOTE_AGENT_AI_GATEWAY_ID?: string;
    OPENMELD_REMOTE_AGENT_OPENROUTER_BYOK_ALIAS?: string;
  };
  request: unknown;
}): Promise<RemoteAgentTransientSlackContextResponse> {
  const request = remoteAgentTransientSlackContextRequestSchema.parse(
    input.request
  );
  const coreSearch =
    input.env.OPENMELD_CORE_WORKER?.centerAgentReadTransientSlackSearch;
  if (typeof coreSearch !== "function") {
    throw new Error(
      "OPENMELD_CORE_WORKER.centerAgentReadTransientSlackSearch is unavailable."
    );
  }
  const headers = buildRemoteAgentZeroRetentionAiGatewayHeaders({
    env: input.env,
  });
  const model = buildTransientSlackModel({ env: input.env, request, headers });
  return await runTransientSlackContextReasoning({
    complete: async (context) =>
      await complete(model, context, {
        apiKey: "unused",
        headers,
        maxRetries: 0,
        onPayload: prepareRemoteAgentZeroRetentionOpenRouterPayload,
        reasoningEffort:
          request.modelRoute.reasoningLevel === "off"
            ? undefined
            : request.modelRoute.reasoningLevel,
        timeoutMs: 45_000,
        toolChoice: resolveTransientSlackToolChoice(context),
      }),
    input: request,
    search: async ({ includeBots, query }) => {
      const result = await coreSearch({
        includeBots,
        organizationId: request.organizationId,
        query,
        requestContext: request.requestContext,
        requester: {
          memberId: request.requester.memberId,
          slackUserId: request.requester.slackUserId,
          userId: request.requester.userId,
        },
        searchAuthorization: request.searchAuthorization,
        v: 1,
      });
      return remoteAgentTransientSlackSearchResponseSchema.parse(result);
    },
  });
}

export function buildTransientSlackModel(input: {
  env: {
    OPENMELD_REMOTE_AGENT_AI_GATEWAY_ACCOUNT_ID?: string;
    OPENMELD_REMOTE_AGENT_AI_GATEWAY_ID?: string;
  };
  headers: Record<string, string | null>;
  request: RemoteAgentTransientSlackContextRequest;
}): Model<"openai-completions"> {
  const builtinModel = getBuiltinModels("openrouter").find(
    (candidate) =>
      candidate.api === "openai-completions" &&
      candidate.id === input.request.modelRoute.modelId
  ) as Model<"openai-completions"> | undefined;
  const modelRoute = input.request.modelRoute;
  return {
    api: "openai-completions",
    baseUrl: resolveRemoteAgentAiGatewayOpenRouterBaseUrl(input.env),
    compat: {
      supportsDeveloperRole:
        modelRoute.modelId.startsWith("anthropic/") ||
        modelRoute.modelId.startsWith("openai/"),
      ...builtinModel?.compat,
      thinkingFormat: "openrouter",
    },
    contextWindow: modelRoute.contextWindow,
    cost: builtinModel?.cost ?? {
      cacheRead: 0,
      cacheWrite: 0,
      input: 0,
      output: 0,
    },
    headers: input.headers as Record<string, string>,
    id: modelRoute.modelId,
    input: modelRoute.inputModalities,
    maxTokens: Math.min(modelRoute.maxOutputTokens, 4096),
    name: modelRoute.displayName,
    provider: modelRoute.provider,
    reasoning: modelRoute.reasoningLevel !== "off",
  };
}

function buildTransientSlackSystemPrompt(input: ReasoningInput): string {
  return [
    `You are the Center Agent speaking directly with ${input.requester.displayName}.`,
    `Decide whether this request needs workspace-wide public Slack evidence through ${TRANSIENT_SLACK_DECISION_TOOL}. If it does not, choose continue_normal_conversation and do not answer here.`,
    "If the request asks to save, remember, update a Profile Report, create a document, or start any other durable action, choose continue_normal_conversation. Durable work belongs to the ordinary Center Agent flow.",
    `The requester's exact Slack user ID is ${input.requester.slackUserId}. When learning about this requester, begin with a focused \`from:<@${input.requester.slackUserId}>\` search instead of guessing from their display name.`,
    "Search iteratively with focused queries. Prefer the requester's own messages, then read the nearby context Slack returns. Stop once the evidence is sufficient or further searches are unlikely to help.",
    "For a broad work or collaboration question, do not conclude from one dominant channel or one narrow activity. If the first result is concentrated in one channel, make a follow-up search that excludes that channel and sample another relevant public work context before answering.",
    "Speak in first person and in the user's language. Be concise, warm, specific, and transparent about exactly what you searched and what you could or could not verify.",
    "Never claim a fact without supporting evidence. Include Slack permalinks for the most useful claims.",
    "This evidence is transient. Do not offer to save it, create a Profile Report from it, or imply that it became memory.",
  ].join("\n");
}

function closeTransientSlackSearchIfComplete(input: {
  context: Context;
  evidenceItems: number;
  searchCalls: number;
}): void {
  if (
    input.evidenceItems < MAX_EVIDENCE_ITEMS &&
    input.searchCalls < MAX_SEARCH_CALLS
  ) {
    return;
  }
  input.context.tools = [];
  input.context.systemPrompt = [
    input.context.systemPrompt,
    "Slack search is now closed because the bounded evidence or search budget is complete. Answer now using only the evidence already returned. Clearly distinguish what the evidence supports from what remains uncertain.",
  ].join("\n");
}

function resolveTransientSlackToolChoice(context: Context) {
  if (context.tools?.length === 0) {
    return undefined;
  }
  if (context.messages.some((message) => message.role === "toolResult")) {
    return "auto" as const;
  }
  return {
    function: { name: TRANSIENT_SLACK_DECISION_TOOL },
    type: "function" as const,
  };
}

function boundSearchEvidence(input: {
  remainingItems: number;
  result: RemoteAgentTransientSlackSearchResponse;
  seenPermalinks: Set<string>;
}): {
  evidenceItemCount: number;
  result: RemoteAgentTransientSlackSearchResponse;
} {
  if (input.result.status !== "found") {
    return { evidenceItemCount: 0, result: input.result };
  }
  let retained = 0;
  const messages = input.result.messages.flatMap((message) => {
    if (
      retained >= input.remainingItems ||
      input.seenPermalinks.has(message.permalink)
    ) {
      return [];
    }
    input.seenPermalinks.add(message.permalink);
    retained += 1;
    const contextMessages = message.contextMessages.flatMap((context) => {
      if (
        retained >= input.remainingItems ||
        input.seenPermalinks.has(context.permalink)
      ) {
        return [];
      }
      input.seenPermalinks.add(context.permalink);
      retained += 1;
      return [context];
    });
    return [{ ...message, contextMessages }];
  });
  return {
    evidenceItemCount: retained,
    result: { ...input.result, messages },
  };
}

function normalizeToolString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized || null;
}
