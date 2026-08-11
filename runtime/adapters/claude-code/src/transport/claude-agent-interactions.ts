import type {
  CanUseTool,
  ElicitationRequest,
  ElicitationResult,
  OnElicitation,
  PermissionResult,
  PermissionUpdate,
} from "@anthropic-ai/claude-agent-sdk";
import type {
  AdapterInteractionCallback,
  AdapterInteractionRequest,
} from "@openmeld/adapter-core";

type ClaudePermissionContext = Parameters<CanUseTool>[2];
type QuestionRequest = Extract<
  AdapterInteractionRequest,
  { kind: "question" }
>["questions"][number];

export function createClaudeCanUseTool(input: {
  getPlanReviewText: () => Promise<string> | string;
  onInteractionRequest: AdapterInteractionCallback;
}): CanUseTool {
  const inFlightByToolUseId = new Map<string, Promise<PermissionResult>>();
  return (toolName, toolInput, context) => {
    const existing = inFlightByToolUseId.get(context.toolUseID);
    if (existing) {
      return existing;
    }
    const pending = waitForClaudeInteractionOrAbort<PermissionResult>({
      onAbort: (): PermissionResult => ({
        behavior: "deny",
        interrupt: true,
        message: "Cancelled because Claude stopped waiting for this response.",
        toolUseID: context.toolUseID,
      }),
      signal: context.signal,
      start: () =>
        resolveClaudeToolInteraction({
          context,
          getPlanReviewText: input.getPlanReviewText,
          onInteractionRequest: input.onInteractionRequest,
          toolInput,
          toolName,
        }),
    });
    inFlightByToolUseId.set(context.toolUseID, pending);
    clearTrackedInteractionWhenSettled({
      inFlight: inFlightByToolUseId,
      key: context.toolUseID,
      pending,
    });
    return pending;
  };
}

export function createClaudeOnElicitation(input: {
  onInteractionRequest: AdapterInteractionCallback;
}): OnElicitation {
  const inFlight = new Map<string, Promise<ElicitationResult>>();
  return (request, options) => {
    const key = [
      request.serverName,
      request.mode ?? "form",
      request.elicitationId ?? request.message,
    ].join(":");
    const existing = inFlight.get(key);
    if (existing) {
      return existing;
    }
    const pending = waitForClaudeInteractionOrAbort<ElicitationResult>({
      onAbort: (): ElicitationResult => ({ action: "cancel" }),
      signal: options.signal,
      start: () =>
        resolveClaudeElicitation({
          onInteractionRequest: input.onInteractionRequest,
          request,
        }),
    });
    inFlight.set(key, pending);
    clearTrackedInteractionWhenSettled({ inFlight, key, pending });
    return pending;
  };
}

function clearTrackedInteractionWhenSettled<T>(input: {
  inFlight: Map<string, Promise<T>>;
  key: string;
  pending: Promise<T>;
}): void {
  const clear = (): void => {
    if (input.inFlight.get(input.key) === input.pending) {
      input.inFlight.delete(input.key);
    }
  };
  input.pending.then(clear, clear);
}

function waitForClaudeInteractionOrAbort<T>(input: {
  onAbort: () => T;
  signal: AbortSignal;
  start: () => Promise<T>;
}): Promise<T> {
  if (input.signal.aborted) {
    return Promise.resolve(input.onAbort());
  }
  const pending = input.start();
  return new Promise<T>((resolve, reject) => {
    const handleAbort = (): void => {
      resolve(input.onAbort());
    };
    input.signal.addEventListener("abort", handleAbort, { once: true });
    pending.then(
      (value) => {
        input.signal.removeEventListener("abort", handleAbort);
        resolve(value);
      },
      (error: unknown) => {
        input.signal.removeEventListener("abort", handleAbort);
        reject(error);
      }
    );
  });
}

async function resolveClaudeToolInteraction(input: {
  context: ClaudePermissionContext;
  getPlanReviewText: () => Promise<string> | string;
  onInteractionRequest: AdapterInteractionCallback;
  toolInput: Record<string, unknown>;
  toolName: string;
}): Promise<PermissionResult> {
  if (input.toolName === "AskUserQuestion") {
    return await resolveAskUserQuestion(input);
  }
  if (input.toolName === "ExitPlanMode") {
    return await resolveExitPlanMode(input);
  }
  return await resolveToolPermission(input);
}

async function resolveToolPermission(input: {
  context: ClaudePermissionContext;
  onInteractionRequest: AdapterInteractionCallback;
  toolInput: Record<string, unknown>;
  toolName: string;
}): Promise<PermissionResult> {
  const allowOnceOptionId = "claude-permission-once";
  const allowSessionOptionId = "claude-permission-session";
  const allowAlwaysOptionId = "claude-permission-always";
  const denyOptionId = "claude-permission-deny";
  const sessionSuggestions = (input.context.suggestions ?? []).filter(
    (suggestion) =>
      suggestion.destination === "session" ||
      suggestion.destination === "cliArg"
  );
  const persistentSuggestions = (input.context.suggestions ?? []).filter(
    (suggestion) =>
      suggestion.destination === "userSettings" ||
      suggestion.destination === "projectSettings" ||
      suggestion.destination === "localSettings"
  );
  const options: Extract<
    AdapterInteractionRequest,
    { kind: "permission" }
  >["options"] = [
    {
      intent: "allow_once",
      label: "Allow once",
      optionId: allowOnceOptionId,
    },
    ...(sessionSuggestions.length > 0
      ? [
          {
            intent: "allow_session" as const,
            label: "Allow for this session",
            optionId: allowSessionOptionId,
          },
        ]
      : []),
    ...(persistentSuggestions.length > 0
      ? [
          {
            intent: "allow_always" as const,
            label: "Always allow",
            optionId: allowAlwaysOptionId,
          },
        ]
      : []),
    {
      intent: "deny",
      label: "Deny",
      optionId: denyOptionId,
    },
  ];
  const response = await input.onInteractionRequest({
    ...(normalizeBoundedText(
      input.context.description ?? input.context.decisionReason,
      4000
    )
      ? {
          description: normalizeBoundedText(
            input.context.description ?? input.context.decisionReason,
            4000
          ),
        }
      : {}),
    kind: "permission",
    options,
    subject: buildPermissionSubject({
      blockedPath: input.context.blockedPath,
      toolInput: input.toolInput,
      toolName: input.toolName,
    }),
    title:
      normalizeBoundedText(input.context.title, 240) ??
      `Allow Claude to use ${input.context.displayName ?? input.toolName}?`,
  });
  const optionId =
    response.kind === "permission" ? response.optionId : denyOptionId;

  if (optionId === allowOnceOptionId) {
    return allowTool(input);
  }
  if (optionId === allowSessionOptionId) {
    return allowTool(input, sessionSuggestions);
  }
  if (optionId === allowAlwaysOptionId) {
    return allowTool(input, input.context.suggestions);
  }
  return {
    behavior: "deny",
    interrupt: response.kind === "cancel",
    message:
      response.kind === "cancel"
        ? "Cancelled by the user."
        : "Denied by the user.",
    toolUseID: input.context.toolUseID,
  };
}

function allowTool(
  input: {
    context: ClaudePermissionContext;
    toolInput: Record<string, unknown>;
  },
  updatedPermissions?: PermissionUpdate[]
): PermissionResult {
  return {
    behavior: "allow",
    toolUseID: input.context.toolUseID,
    updatedInput: input.toolInput,
    ...(updatedPermissions && updatedPermissions.length > 0
      ? { updatedPermissions }
      : {}),
  };
}

function buildPermissionSubject(input: {
  blockedPath?: string;
  toolInput: Record<string, unknown>;
  toolName: string;
}): Extract<AdapterInteractionRequest, { kind: "permission" }>["subject"] {
  const command = normalizeBoundedText(input.toolInput.command, 16_000);
  if (input.toolName === "Bash" && command) {
    return {
      command,
      type: "command",
    };
  }
  const resource = normalizeBoundedText(
    input.blockedPath ??
      input.toolInput.file_path ??
      input.toolInput.path ??
      input.toolName,
    4096
  );
  if (
    input.toolName === "Edit" ||
    input.toolName === "MultiEdit" ||
    input.toolName === "Write"
  ) {
    return {
      ...(resource ? { resource } : {}),
      type: "file_change",
    };
  }
  return {
    ...(resource ? { resource } : {}),
    type: "tool",
  };
}

async function resolveAskUserQuestion(input: {
  context: ClaudePermissionContext;
  onInteractionRequest: AdapterInteractionCallback;
  toolInput: Record<string, unknown>;
}): Promise<PermissionResult> {
  const rawQuestions = Array.isArray(input.toolInput.questions)
    ? input.toolInput.questions
    : [];
  const answers: Record<string, string> = {};

  for (let offset = 0; offset < rawQuestions.length; offset += 3) {
    const mapped = rawQuestions
      .slice(offset, offset + 3)
      .map((question, index) => mapClaudeQuestion(question, offset + index));
    const response = await input.onInteractionRequest({
      kind: "question",
      questions: mapped.map(({ request }) => request),
      title: "Claude needs your input",
    });
    if (response.kind === "cancel") {
      return {
        behavior: "deny",
        interrupt: true,
        message: "Cancelled by the user.",
        toolUseID: input.context.toolUseID,
      };
    }
    if (response.kind !== "question") {
      return {
        behavior: "deny",
        interrupt: false,
        message: "The question was not answered.",
        toolUseID: input.context.toolUseID,
      };
    }
    for (const answer of response.answers) {
      const question = mapped.find(
        ({ request }) => request.questionId === answer.questionId
      );
      if (!question) {
        continue;
      }
      answers[question.providerQuestion] = answer.values
        .map((value) => question.optionLabelById.get(value) ?? value)
        .join(", ");
    }
  }

  return {
    behavior: "allow",
    toolUseID: input.context.toolUseID,
    updatedInput: {
      ...input.toolInput,
      answers,
    },
  };
}

function mapClaudeQuestion(
  value: unknown,
  questionIndex: number
): {
  optionLabelById: ReadonlyMap<string, string>;
  providerQuestion: string;
  request: QuestionRequest;
} {
  const question = toRecord(value) ?? {};
  const providerQuestion =
    normalizeBoundedText(question.question, 4000) ??
    `Question ${questionIndex + 1}`;
  const questionId = `claude-question-${questionIndex}`;
  const optionLabelById = new Map<string, string>();
  const options = (Array.isArray(question.options) ? question.options : [])
    .slice(0, 20)
    .map((value, optionIndex) => {
      const option = toRecord(value) ?? {};
      const label =
        normalizeBoundedText(option.label, 240) ?? `Option ${optionIndex + 1}`;
      const optionId = `${questionId}-option-${optionIndex}`;
      optionLabelById.set(optionId, label);
      const description = normalizeBoundedText(option.description, 1000);
      return {
        ...(description ? { description } : {}),
        label,
        optionId,
      };
    });
  return {
    optionLabelById,
    providerQuestion,
    request: {
      allowOther: true,
      ...(normalizeBoundedText(question.header, 120)
        ? { header: normalizeBoundedText(question.header, 120) }
        : {}),
      multiple: question.multiSelect === true,
      options,
      prompt: providerQuestion,
      questionId,
    },
  };
}

async function resolveExitPlanMode(input: {
  context: ClaudePermissionContext;
  getPlanReviewText: () => Promise<string> | string;
  onInteractionRequest: AdapterInteractionCallback;
}): Promise<PermissionResult> {
  const planReviewText = await input.getPlanReviewText();
  const response = await input.onInteractionRequest({
    allowFeedback: true,
    kind: "plan_review",
    plan:
      normalizeBoundedText(planReviewText, 64_000) ??
      "Claude has finished planning and is ready to start implementation.",
    title: "Review Claude's plan",
  });
  if (response.kind === "plan_review" && response.action === "approve") {
    return {
      behavior: "allow",
      toolUseID: input.context.toolUseID,
    };
  }
  if (
    response.kind === "plan_review" &&
    response.action === "request_changes"
  ) {
    return {
      behavior: "deny",
      interrupt: false,
      message: response.feedback ?? "Please revise the plan.",
      toolUseID: input.context.toolUseID,
    };
  }
  return {
    behavior: "deny",
    interrupt: true,
    message: "Cancelled by the user.",
    toolUseID: input.context.toolUseID,
  };
}

async function resolveClaudeElicitation(input: {
  onInteractionRequest: AdapterInteractionCallback;
  request: ElicitationRequest;
}): Promise<ElicitationResult> {
  if (input.request.mode === "url" && input.request.url) {
    return await resolveUrlElicitation({
      ...input,
      url: input.request.url,
    });
  }
  return await resolveFormElicitation(input);
}

async function resolveUrlElicitation(input: {
  onInteractionRequest: AdapterInteractionCallback;
  request: ElicitationRequest;
  url: string;
}): Promise<ElicitationResult> {
  const completedOptionId = "claude-elicitation-completed";
  const declineOptionId = "claude-elicitation-decline";
  const response = await input.onInteractionRequest({
    description:
      normalizeBoundedText(
        input.request.description ?? input.request.message,
        4000
      ) ?? "Complete the requested step, then continue.",
    kind: "permission",
    options: [
      {
        intent: "allow_once",
        label: "I've completed this step",
        optionId: completedOptionId,
      },
      {
        intent: "deny",
        label: "Decline",
        optionId: declineOptionId,
      },
    ],
    subject: {
      resource: input.url.slice(0, 4096),
      type: "tool",
    },
    title:
      normalizeBoundedText(input.request.title, 240) ??
      `${input.request.displayName ?? input.request.serverName} needs your attention`,
  });
  if (
    response.kind === "permission" &&
    response.optionId === completedOptionId
  ) {
    return { action: "accept" };
  }
  return { action: response.kind === "cancel" ? "cancel" : "decline" };
}

async function resolveFormElicitation(input: {
  onInteractionRequest: AdapterInteractionCallback;
  request: ElicitationRequest;
}): Promise<ElicitationResult> {
  const schema = input.request.requestedSchema;
  const properties = toRecord(schema?.properties);
  if (!properties) {
    return { action: "decline" };
  }
  const fields = Object.entries(properties).map(([name, value], index) =>
    mapElicitationField(name, value, index)
  );
  if (fields.length === 0) {
    return { action: "decline" };
  }
  const content: Record<string, string | number | boolean | string[]> = {};
  for (let offset = 0; offset < fields.length; offset += 3) {
    const chunk = fields.slice(offset, offset + 3);
    const description = normalizeBoundedText(
      input.request.description ?? input.request.message,
      4000
    );
    const response = await input.onInteractionRequest({
      ...(description ? { description } : {}),
      kind: "question",
      questions: chunk.map(({ request }) => request),
      title:
        normalizeBoundedText(input.request.title, 240) ??
        `${input.request.displayName ?? input.request.serverName} needs your input`,
    });
    if (response.kind === "cancel") {
      return { action: "cancel" };
    }
    if (response.kind !== "question") {
      return { action: "decline" };
    }
    for (const answer of response.answers) {
      const field = chunk.find(
        ({ request }) => request.questionId === answer.questionId
      );
      if (!field) {
        continue;
      }
      const values = answer.values.map(
        (value) => field.optionValueById.get(value) ?? value
      );
      content[field.name] = field.convert(values);
    }
  }
  return { action: "accept", content };
}

function mapElicitationField(
  name: string,
  value: unknown,
  fieldIndex: number
): {
  convert: (values: string[]) => string | number | boolean | string[];
  name: string;
  optionValueById: ReadonlyMap<string, string>;
  request: QuestionRequest;
} {
  const field = toRecord(value) ?? {};
  const itemSchema = toRecord(field.items);
  const rawValues = resolveElicitationOptionValues(field, itemSchema);
  const questionId = `claude-elicitation-field-${fieldIndex}`;
  const optionValueById = new Map<string, string>();
  const options = rawValues.slice(0, 20).map((rawValue, optionIndex) => {
    const label = String(rawValue);
    const optionId = `${questionId}-option-${optionIndex}`;
    optionValueById.set(optionId, label);
    return { label: label.slice(0, 240), optionId };
  });
  const multiple = field.type === "array";
  return {
    convert: (values) => {
      if (multiple) {
        return values;
      }
      return convertElicitationValue(values[0] ?? "", field);
    },
    name,
    optionValueById,
    request: {
      allowOther: options.length === 0,
      ...(normalizeBoundedText(field.title, 120)
        ? { header: normalizeBoundedText(field.title, 120) }
        : { header: name.slice(0, 120) }),
      multiple,
      options,
      prompt:
        normalizeBoundedText(field.description, 4000) ??
        `Enter ${name.replaceAll("_", " ")}.`,
      questionId,
      ...(field.format === "password" || field.writeOnly === true
        ? { secret: true }
        : {}),
    },
  };
}

function resolveElicitationOptionValues(
  field: Record<string, unknown>,
  itemSchema: Record<string, unknown> | null
): unknown[] {
  if (Array.isArray(field.enum)) {
    return field.enum;
  }
  if (Array.isArray(itemSchema?.enum)) {
    return itemSchema.enum;
  }
  return field.type === "boolean" ? [true, false] : [];
}

function convertElicitationValue(
  value: string,
  schema: Record<string, unknown> | null
): string | number | boolean {
  if (schema?.type === "boolean") {
    return value === "true";
  }
  if (schema?.type === "number" || schema?.type === "integer") {
    const numberValue = Number(value);
    return Number.isFinite(numberValue) ? numberValue : value;
  }
  return value;
}

function normalizeBoundedText(
  value: unknown,
  maxLength: number
): string | null {
  const normalized = String(value ?? "").trim();
  return normalized ? normalized.slice(0, maxLength) : null;
}

function toRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}
