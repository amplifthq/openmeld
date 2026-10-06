import type {
  PermissionOption,
  RequestPermissionRequest,
  RequestPermissionResponse,
} from "@agentclientprotocol/sdk";
import type {
  AdapterInteractionCallback,
  AdapterInteractionRequest,
} from "@openmeld/adapter-core";

type Permission = Extract<AdapterInteractionRequest, { kind: "permission" }>;
const CANCELLED: RequestPermissionResponse = {
  outcome: { outcome: "cancelled" },
};

// Antigravity questions share the permission method. Preserve native option IDs;
// a question choice is never permission to execute a tool.
export async function answerAntigravityAcpInteraction(
  request: RequestPermissionRequest,
  callback?: AdapterInteractionCallback,
  signal?: AbortSignal
): Promise<RequestPermissionResponse> {
  if (!(callback && request.toolCall && Array.isArray(request.options))) {
    return CANCELLED;
  }
  const options = request.options;
  if (
    !options.length ||
    options.length > 20 ||
    options.some(
      (option) => !option.optionId || option.optionId.length > 256
    ) ||
    new Set(options.map((option) => option.optionId)).size !== options.length
  ) {
    return CANCELLED;
  }
  if (signal?.aborted) {
    return CANCELLED;
  }
  const stopped = Promise.withResolvers<undefined>();
  const onAbort = () => stopped.resolve(undefined);
  signal?.addEventListener("abort", onAbort, { once: true });
  let selected: string | undefined;
  try {
    selected = await Promise.race([
      request.toolCall.toolCallId.startsWith("interaction_")
        ? answerQuestion(request, callback)
        : answerPermission(request, callback),
      stopped.promise,
    ]);
  } finally {
    signal?.removeEventListener("abort", onAbort);
  }
  return selected && options.some((option) => option.optionId === selected)
    ? { outcome: { outcome: "selected", optionId: selected } }
    : CANCELLED;
}

async function answerQuestion(
  request: RequestPermissionRequest,
  callback: AdapterInteractionCallback
) {
  const response = await callback({
    kind: "question",
    title: "Antigravity needs your input",
    questions: [
      {
        questionId: "choice",
        prompt: (request.toolCall.title || "Choose an option.").slice(0, 4000),
        allowOther: false,
        multiple: false,
        options: request.options.map((option) => ({
          optionId: option.optionId,
          label: option.name.slice(0, 240),
        })),
      },
    ],
  });
  if (response.kind !== "question") {
    return;
  }
  const values = response.answers.find(
    (answer) => answer.questionId === "choice"
  )?.values;
  return values?.length === 1 ? values[0] : undefined;
}

async function answerPermission(
  request: RequestPermissionRequest,
  callback: AdapterInteractionCallback
) {
  const choices = request.options.flatMap((option) => {
    const intent = permissionIntent(option.kind);
    return intent
      ? [
          {
            optionId: option.optionId,
            intent,
            label:
              intent === "allow_session"
                ? "Allow for this conversation"
                : option.name.slice(0, 240),
          },
        ]
      : [];
  });
  if (!choices.length) {
    return;
  }
  const response = await callback({
    kind: "permission",
    title: "Antigravity needs permission",
    description: [
      request.toolCall.title,
      ...request.options.flatMap(securityWarning),
    ]
      .filter(Boolean)
      .join("\n")
      .slice(0, 4000),
    subject: { type: permissionSubject(request.toolCall.kind) },
    options: choices,
  });
  return response.kind === "permission" &&
    choices.some((option) => option.optionId === response.optionId)
    ? response.optionId
    : undefined;
}

function permissionIntent(
  kind: string
): Permission["options"][number]["intent"] | null {
  switch (kind) {
    case "allow_once":
      return "allow_once";
    case "allow_always":
      return "allow_session";
    case "reject_once":
    case "reject_always":
      return "deny";
    default:
      return null;
  }
}

function permissionSubject(
  kind: string | null | undefined
): Permission["subject"]["type"] {
  if (kind === "execute") {
    return "command";
  }
  return ["edit", "delete", "move"].includes(kind ?? "")
    ? "file_change"
    : "tool";
}

function securityWarning(option: PermissionOption): string[] {
  const warning = option._meta?.["agy.security.warning"];
  if (!warning || typeof warning !== "object" || Array.isArray(warning)) {
    return [];
  }
  const record = warning as Record<string, unknown>;
  const value = record.message ?? record.title;
  return typeof value === "string" ? [value] : [];
}
