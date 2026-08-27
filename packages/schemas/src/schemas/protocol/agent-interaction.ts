import type * as zod from "zod/v4";
import * as z from "../../lazy-zod";

export const AGENT_INTERACTION_SCHEMA_VERSION = 1 as const;
export const AGENT_INTERACTION_DEFAULT_TIMEOUT_MS = 8 * 60 * 60 * 1000;

export const agentInteractionKindSchema = z.enum([
  "permission",
  "question",
  "plan_review",
]);

export const agentInteractionPermissionOptionIntentSchema = z.enum([
  "allow_once",
  "allow_session",
  "allow_always",
  "deny",
]);

export const agentInteractionPermissionOptionSchema = z.strictObject({
  optionId: z.string().trim().min(1).max(256),
  label: z.string().trim().min(1).max(120),
  intent: agentInteractionPermissionOptionIntentSchema,
});

export const agentInteractionPermissionSubjectSchema = z.strictObject({
  type: z.enum([
    "command",
    "file_change",
    "tool",
    "additional_permissions",
    "other",
  ]),
  command: z.string().trim().min(1).max(16_000).nullable().optional(),
  cwd: z.string().trim().min(1).max(4096).nullable().optional(),
  resource: z.string().trim().min(1).max(4096).nullable().optional(),
});

export const agentInteractionQuestionOptionSchema = z.strictObject({
  optionId: z.string().trim().min(1).max(256),
  label: z.string().trim().min(1).max(240),
  description: z.string().trim().min(1).max(1000).nullable().optional(),
});

export const agentInteractionQuestionSchema = z.strictObject({
  questionId: z.string().trim().min(1).max(256),
  header: z.string().trim().min(1).max(120).nullable().optional(),
  prompt: z.string().trim().min(1).max(4000),
  options: z.array(agentInteractionQuestionOptionSchema).max(20),
  multiple: z.boolean(),
  allowOther: z.boolean(),
  secret: z.boolean().optional(),
});

const agentInteractionBaseRequestShape = {
  v: z.literal(AGENT_INTERACTION_SCHEMA_VERSION),
  interactionId: z.string().trim().min(1).max(256),
  requestedAtMs: z.number().int().nonnegative(),
  expiresAtMs: z.number().int().nonnegative(),
  title: z.string().trim().min(1).max(240),
  description: z.string().trim().min(1).max(4000).nullable().optional(),
} as const;

export const agentInteractionRequestSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    ...agentInteractionBaseRequestShape,
    kind: z.literal("permission"),
    options: z.array(agentInteractionPermissionOptionSchema).min(1).max(8),
    subject: agentInteractionPermissionSubjectSchema,
  }),
  z.strictObject({
    ...agentInteractionBaseRequestShape,
    kind: z.literal("question"),
    questions: z.array(agentInteractionQuestionSchema).min(1).max(3),
  }),
  z.strictObject({
    ...agentInteractionBaseRequestShape,
    kind: z.literal("plan_review"),
    plan: z.string().trim().min(1).max(64_000),
    allowFeedback: z.boolean(),
  }),
]);

export const agentInteractionQuestionAnswerSchema = z.strictObject({
  questionId: z.string().trim().min(1).max(256),
  values: z.array(z.string().trim().min(1).max(4000)).min(1).max(20),
});

export const agentInteractionResponseSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("permission"),
    optionId: z.string().trim().min(1).max(256),
  }),
  z.strictObject({
    kind: z.literal("question"),
    answers: z.array(agentInteractionQuestionAnswerSchema).min(1).max(3),
  }),
  z.strictObject({
    kind: z.literal("plan_review"),
    action: z.enum(["approve", "request_changes"]),
    feedback: z.string().trim().min(1).max(8000).nullable().optional(),
  }),
  z.strictObject({
    kind: z.literal("cancel"),
  }),
]);

type AgentInteractionRequest = zod.infer<typeof agentInteractionRequestSchema>;
type AgentInteractionResponse = zod.infer<
  typeof agentInteractionResponseSchema
>;
type AgentInteractionResolutionIssue = {
  message: string;
  path: string[];
};

const resolveQuestionResponseIssue = (input: {
  request: Extract<AgentInteractionRequest, { kind: "question" }>;
  response: Extract<AgentInteractionResponse, { kind: "question" }>;
}): AgentInteractionResolutionIssue | null => {
  const answerByQuestionId = new Map(
    input.response.answers.map((answer) => [answer.questionId, answer])
  );
  if (
    answerByQuestionId.size !== input.request.questions.length ||
    input.response.answers.length !== input.request.questions.length
  ) {
    return {
      message: "question response must answer every question exactly once",
      path: ["response", "answers"],
    };
  }
  for (const question of input.request.questions) {
    const answer = answerByQuestionId.get(question.questionId);
    if (!answer) {
      return {
        message: `missing answer for question '${question.questionId}'`,
        path: ["response", "answers"],
      };
    }
    if (!question.multiple && answer.values.length !== 1) {
      return {
        message: "single-choice questions require exactly one answer",
        path: ["response", "answers"],
      };
    }
    const knownOptionIds = new Set(
      question.options.map((option) => option.optionId)
    );
    if (
      !question.allowOther &&
      answer.values.some((value) => !knownOptionIds.has(value))
    ) {
      return {
        message: "question response contains an unavailable option",
        path: ["response", "answers"],
      };
    }
  }
  return null;
};

const resolveAgentInteractionResolutionIssue = (input: {
  request: AgentInteractionRequest;
  response: AgentInteractionResponse;
}): AgentInteractionResolutionIssue | null => {
  const { request, response } = input;
  if (response.kind === "cancel") {
    return null;
  }
  if (request.kind !== response.kind) {
    return {
      message: "response kind must match the pending interaction",
      path: ["response", "kind"],
    };
  }
  if (request.kind === "permission" && response.kind === "permission") {
    return request.options.some(
      (option) => option.optionId === response.optionId
    )
      ? null
      : {
          message: "permission response must select an available option",
          path: ["response", "optionId"],
        };
  }
  if (request.kind === "plan_review" && response.kind === "plan_review") {
    if (
      response.action === "request_changes" &&
      !(request.allowFeedback && response.feedback)
    ) {
      return {
        message:
          "plan change requests require feedback when feedback is allowed",
        path: ["response", "feedback"],
      };
    }
    return response.action === "approve" && response.feedback
      ? {
          message: "approved plans must not include change feedback",
          path: ["response", "feedback"],
        }
      : null;
  }
  if (request.kind === "question" && response.kind === "question") {
    return resolveQuestionResponseIssue({ request, response });
  }
  return null;
};

export const agentInteractionResolutionSchema = z
  .strictObject({
    request: agentInteractionRequestSchema,
    response: agentInteractionResponseSchema,
  })
  .superRefine((value, context) => {
    const issue = resolveAgentInteractionResolutionIssue(value);
    if (!issue) {
      return;
    }
    context.addIssue({
      code: "custom",
      message: issue.message,
      path: issue.path,
    });
  });

export const agentInteractionPendingSummarySchema = z.strictObject({
  interactionId: z.string().trim().min(1).max(256),
  kind: agentInteractionKindSchema,
  requestedAtMs: z.number().int().nonnegative(),
  expiresAtMs: z.number().int().nonnegative(),
  canRespond: z.boolean(),
  request: agentInteractionRequestSchema.nullable(),
});
