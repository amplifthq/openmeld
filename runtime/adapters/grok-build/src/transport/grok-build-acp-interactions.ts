import type {
  AdapterInteractionCallback,
  AdapterInteractionRequest,
} from "@openmeld/adapter-core";

type GrokPermissionOption = {
  kind: string;
  label: string;
  optionId: string;
};

type GrokInteractionResult =
  | { handled: false }
  | { handled: true; result: Record<string, unknown> };

const ASK_USER_QUESTION_METHODS = new Set([
  "x.ai/ask_user_question",
  "_x.ai/ask_user_question",
]);
const EXIT_PLAN_MODE_METHODS = new Set([
  "x.ai/exit_plan_mode",
  "_x.ai/exit_plan_mode",
]);

export async function resolveGrokBuildAcpInteraction(input: {
  method: string;
  onInteractionRequest: AdapterInteractionCallback;
  params: unknown;
}): Promise<GrokInteractionResult> {
  if (input.method === "session/request_permission") {
    return {
      handled: true,
      result: await resolvePermissionInteraction(input),
    };
  }
  if (ASK_USER_QUESTION_METHODS.has(input.method)) {
    return {
      handled: true,
      result: await resolveQuestionInteraction(input),
    };
  }
  if (EXIT_PLAN_MODE_METHODS.has(input.method)) {
    return {
      handled: true,
      result: await resolvePlanInteraction(input),
    };
  }
  return { handled: false };
}

export function isGrokBuildQuestionMethod(method: string): boolean {
  return ASK_USER_QUESTION_METHODS.has(method);
}

export function isGrokBuildPlanMethod(method: string): boolean {
  return EXIT_PLAN_MODE_METHODS.has(method);
}

export function readGrokBuildPermissionOptions(
  params: unknown
): GrokPermissionOption[] {
  const record = toRecord(params);
  const options = Array.isArray(record?.options) ? record.options : [];
  return options.flatMap((option) => {
    const optionRecord = toRecord(option);
    const kind = normalizeText(optionRecord?.kind);
    const optionId = normalizeText(optionRecord?.optionId);
    if (!(kind && optionId)) {
      return [];
    }
    return [
      {
        kind,
        label: normalizeText(optionRecord?.name) ?? presentPermissionKind(kind),
        optionId,
      },
    ];
  });
}

async function resolvePermissionInteraction(input: {
  onInteractionRequest: AdapterInteractionCallback;
  params: unknown;
}): Promise<Record<string, unknown>> {
  const params = toRecord(input.params);
  const toolCall = toRecord(params?.toolCall);
  const options = readGrokBuildPermissionOptions(input.params).flatMap(
    (option) => {
      const intent = mapPermissionIntent(option.kind);
      return intent
        ? [
            {
              providerOptionId: option.optionId,
              request: {
                intent,
                label: option.label,
                optionId: option.optionId,
              },
            },
          ]
        : [];
    }
  );
  if (options.length === 0) {
    return { outcome: { outcome: "cancelled" } };
  }
  const response = await input.onInteractionRequest({
    kind: "permission",
    options: options.map(({ request }) => request),
    subject: buildPermissionSubject(toolCall),
    title: buildPermissionTitle(toolCall),
  });
  if (response.kind !== "permission") {
    return { outcome: { outcome: "cancelled" } };
  }
  const selected = options.find(
    ({ request }) => request.optionId === response.optionId
  );
  return selected
    ? {
        outcome: {
          optionId: selected.providerOptionId,
          outcome: "selected",
        },
      }
    : { outcome: { outcome: "cancelled" } };
}

function buildPermissionSubject(
  toolCall: Record<string, unknown> | null
): Extract<AdapterInteractionRequest, { kind: "permission" }>["subject"] {
  const kind = normalizeText(toolCall?.kind);
  const title = normalizeBoundedText(toolCall?.title, 4096);
  const rawInput = toRecord(toolCall?.rawInput);
  const command =
    normalizeBoundedText(rawInput?.command, 16_000) ??
    normalizeBoundedText(toolCall?.command, 16_000);
  if (kind === "execute") {
    return {
      ...(command ? { command } : {}),
      ...(title ? { resource: title } : {}),
      type: "command",
    };
  }
  if (kind === "edit" || kind === "delete" || kind === "move") {
    return {
      ...(title ? { resource: title } : {}),
      type: "file_change",
    };
  }
  return {
    ...(title ? { resource: title } : {}),
    type: "tool",
  };
}

function buildPermissionTitle(
  toolCall: Record<string, unknown> | null
): string {
  switch (normalizeText(toolCall?.kind)) {
    case "execute":
      return "Allow Grok to run this command?";
    case "edit":
    case "delete":
    case "move":
      return "Allow Grok to change these files?";
    default:
      return "Allow Grok to use this tool?";
  }
}

async function resolveQuestionInteraction(input: {
  onInteractionRequest: AdapterInteractionCallback;
  params: unknown;
}): Promise<Record<string, unknown>> {
  const params = toRecord(input.params);
  const rawQuestions = Array.isArray(params?.questions) ? params.questions : [];
  if (rawQuestions.length === 0) {
    return { outcome: "cancelled" };
  }
  const answers: Record<string, string[]> = {};
  const annotations: Record<string, { notes?: string }> = {};

  for (let offset = 0; offset < rawQuestions.length; offset += 3) {
    const mapped = rawQuestions
      .slice(offset, offset + 3)
      .map((question, localIndex) =>
        mapGrokQuestion(question, offset + localIndex)
      );
    const response = await input.onInteractionRequest({
      kind: "question",
      questions: mapped.map(({ request }) => request),
      title: "Grok needs your input",
    });
    if (response.kind !== "question") {
      return { outcome: "cancelled" };
    }
    for (const answer of response.answers) {
      const question = mapped.find(
        ({ request }) => request.questionId === answer.questionId
      );
      if (!question) {
        return { outcome: "cancelled" };
      }
      const providerAnswers: string[] = [];
      for (const value of answer.values) {
        const label = question.providerLabelByOptionId.get(value);
        if (label) {
          providerAnswers.push(label);
          continue;
        }
        providerAnswers.push("Other");
        annotations[question.providerQuestionKey] = { notes: value };
      }
      answers[question.providerQuestionKey] = providerAnswers;
    }
  }

  return {
    ...(Object.keys(annotations).length > 0 ? { annotations } : {}),
    answers,
    outcome: "accepted",
  };
}

function mapGrokQuestion(
  value: unknown,
  index: number
): {
  providerLabelByOptionId: Map<string, string>;
  providerQuestionKey: string;
  request: Extract<
    AdapterInteractionRequest,
    { kind: "question" }
  >["questions"][number];
} {
  const question = toRecord(value);
  const providerQuestionKey =
    normalizeBoundedText(question?.question, 4000) ??
    `Grok question ${index + 1}`;
  const providerLabelByOptionId = new Map<string, string>();
  const options = (Array.isArray(question?.options) ? question.options : [])
    .flatMap((option, optionIndex) => {
      const record = toRecord(option);
      const label = normalizeBoundedText(record?.label, 240);
      if (!label) {
        return [];
      }
      const optionId = `grok-option-${index + 1}-${optionIndex + 1}`;
      providerLabelByOptionId.set(optionId, label);
      return [
        {
          ...(normalizeBoundedText(record?.description, 1000)
            ? {
                description: normalizeBoundedText(
                  record?.description,
                  1000
                ) as string,
              }
            : {}),
          label,
          optionId,
        },
      ];
    })
    .slice(0, 20);
  return {
    providerLabelByOptionId,
    providerQuestionKey,
    request: {
      allowOther: true,
      multiple: question?.multiSelect === true,
      options,
      prompt: providerQuestionKey,
      questionId: `grok-question-${index + 1}`,
    },
  };
}

async function resolvePlanInteraction(input: {
  onInteractionRequest: AdapterInteractionCallback;
  params: unknown;
}): Promise<Record<string, unknown>> {
  const params = toRecord(input.params);
  const plan =
    normalizeBoundedText(params?.planContent, 64_000) ??
    "Grok requested approval without a plan summary.";
  const response = await input.onInteractionRequest({
    allowFeedback: true,
    kind: "plan_review",
    plan,
    title: "Review Grok's plan",
  });
  if (response.kind === "plan_review") {
    return response.action === "approve"
      ? { outcome: "approved" }
      : {
          feedback: response.feedback ?? "Please revise the plan.",
          outcome: "cancelled",
        };
  }
  return { outcome: "abandoned" };
}

function mapPermissionIntent(
  kind: string
): "allow_always" | "allow_once" | "deny" | null {
  switch (kind) {
    case "allow_once":
      return "allow_once";
    case "allow_always":
      return "allow_always";
    case "reject_once":
    case "reject_always":
      return "deny";
    default:
      return null;
  }
}

function presentPermissionKind(kind: string): string {
  switch (kind) {
    case "allow_once":
      return "Allow once";
    case "allow_always":
      return "Allow always";
    case "reject_once":
      return "Reject once";
    case "reject_always":
      return "Reject always";
    default:
      return "Choose";
  }
}

function normalizeBoundedText(
  value: unknown,
  maxLength: number
): string | null {
  const normalized = normalizeText(value);
  return normalized ? normalized.slice(0, maxLength) : null;
}

function normalizeText(value: unknown): string | null {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized.length > 0 ? normalized : null;
}

function toRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
