import type {
  AdapterInteractionCallback,
  AdapterInteractionRequest,
} from "@openmeld/adapter-core";

type CursorPermissionOption = {
  kind: string;
  label: string;
  optionId: string;
};

type CursorInteractionResult =
  | { handled: false }
  | { handled: true; result: Record<string, unknown> };

export async function resolveCursorAcpInteraction(input: {
  method: string;
  onInteractionRequest: AdapterInteractionCallback;
  params: unknown;
}): Promise<CursorInteractionResult> {
  if (input.method === "session/request_permission") {
    return {
      handled: true,
      result: await resolvePermissionInteraction(input),
    };
  }
  if (input.method === "cursor/ask_question") {
    return {
      handled: true,
      result: await resolveQuestionInteraction(input),
    };
  }
  if (input.method === "cursor/create_plan") {
    return {
      handled: true,
      result: await resolvePlanInteraction(input),
    };
  }
  return { handled: false };
}

export function readCursorPermissionOptions(
  params: unknown
): CursorPermissionOption[] {
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
  const options = readCursorPermissionOptions(input.params).flatMap(
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
  const subject = buildPermissionSubject(toolCall);
  const response = await input.onInteractionRequest({
    kind: "permission",
    options: options.map(({ request }) => request),
    subject,
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
      return "Allow Cursor to run this command?";
    case "edit":
    case "delete":
    case "move":
      return "Allow Cursor to change these files?";
    default:
      return "Allow Cursor to use this tool?";
  }
}

async function resolveQuestionInteraction(input: {
  onInteractionRequest: AdapterInteractionCallback;
  params: unknown;
}): Promise<Record<string, unknown>> {
  const params = toRecord(input.params);
  const rawQuestions = Array.isArray(params?.questions) ? params.questions : [];
  const answers: Array<{
    questionId: string;
    selectedOptionIds: string[];
  }> = [];

  for (let offset = 0; offset < rawQuestions.length; offset += 3) {
    const questions = rawQuestions
      .slice(offset, offset + 3)
      .map((question, localIndex) =>
        mapCursorQuestion(question, offset + localIndex)
      );
    const response = await input.onInteractionRequest({
      kind: "question",
      questions,
      title:
        normalizeBoundedText(params?.title, 240) ?? "Cursor needs your input",
    });
    if (response.kind !== "question") {
      return {
        outcome: {
          outcome: "skipped",
          reason: "Cancelled by the user.",
        },
      };
    }
    for (const answer of response.answers) {
      answers.push({
        questionId: answer.questionId,
        selectedOptionIds: answer.values,
      });
    }
  }

  if (answers.length === 0) {
    return {
      outcome: {
        outcome: "skipped",
        reason: "No questions were available to answer.",
      },
    };
  }
  return {
    outcome: {
      answers,
      outcome: "answered",
    },
  };
}

function mapCursorQuestion(
  value: unknown,
  index: number
): Extract<
  AdapterInteractionRequest,
  { kind: "question" }
>["questions"][number] {
  const question = toRecord(value);
  const options = (Array.isArray(question?.options) ? question.options : [])
    .flatMap((option) => {
      const record = toRecord(option);
      const optionId = normalizeText(record?.id);
      const label = normalizeBoundedText(record?.label, 240);
      return optionId && label ? [{ label, optionId }] : [];
    })
    .slice(0, 20);
  return {
    allowOther: options.length === 0,
    multiple: question?.allowMultiple === true,
    options,
    prompt:
      normalizeBoundedText(question?.prompt, 4000) ??
      `Cursor question ${index + 1}`,
    questionId:
      normalizeBoundedText(question?.id, 256) ?? `cursor-question-${index + 1}`,
  };
}

async function resolvePlanInteraction(input: {
  onInteractionRequest: AdapterInteractionCallback;
  params: unknown;
}): Promise<Record<string, unknown>> {
  const params = toRecord(input.params);
  const plan =
    normalizeBoundedText(params?.plan, 64_000) ??
    normalizeBoundedText(params?.overview, 64_000) ??
    formatPlanTodos(params?.todos) ??
    "Cursor created a plan without a text summary.";
  const response = await input.onInteractionRequest({
    allowFeedback: true,
    kind: "plan_review",
    plan,
    title: normalizeBoundedText(params?.name, 200)
      ? `Review Cursor's plan: ${normalizeBoundedText(params?.name, 200)}`
      : "Review Cursor's plan",
  });
  if (response.kind === "plan_review") {
    if (response.action === "approve") {
      return { outcome: { outcome: "accepted" } };
    }
    return {
      outcome: {
        outcome: "rejected",
        reason: response.feedback ?? "Please revise the plan.",
      },
    };
  }
  return { outcome: { outcome: "cancelled" } };
}

function formatPlanTodos(value: unknown): string | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const lines = value.flatMap((todo) => {
    const record = toRecord(todo);
    const content =
      normalizeBoundedText(record?.content, 4000) ??
      normalizeBoundedText(record?.id, 4000);
    return content ? [`- ${content}`] : [];
  });
  return lines.length > 0 ? lines.join("\n").slice(0, 64_000) : null;
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
