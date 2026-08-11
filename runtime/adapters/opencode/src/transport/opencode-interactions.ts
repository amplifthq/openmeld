import type { PermissionRequest, QuestionRequest } from "@opencode-ai/sdk/v2";
import type {
  AdapterInteractionCallback,
  AdapterInteractionRequest,
} from "@openmeld/adapter-core";

export type OpenCodeInteractionClient = {
  permission: {
    reply: (input: {
      directory: string;
      message?: string;
      reply: "always" | "once" | "reject";
      requestID: string;
    }) => Promise<unknown>;
  };
  question: {
    reject: (input: {
      directory: string;
      requestID: string;
    }) => Promise<unknown>;
    reply: (input: {
      answers: string[][];
      directory: string;
      requestID: string;
    }) => Promise<unknown>;
  };
};

export type OpenCodeInteractionFailure = {
  code: string;
  message: string;
};

export class OpenCodeInteractionHandler {
  readonly #client: OpenCodeInteractionClient;
  readonly #directory: string;
  readonly #onInteractionRequest?: AdapterInteractionCallback;
  readonly #processedRequestIds = new Set<string>();
  #failure: OpenCodeInteractionFailure | null = null;

  constructor(input: {
    client: OpenCodeInteractionClient;
    directory: string;
    onInteractionRequest?: AdapterInteractionCallback;
  }) {
    this.#client = input.client;
    this.#directory = input.directory;
    this.#onInteractionRequest = input.onInteractionRequest;
  }

  readFailure(): OpenCodeInteractionFailure | null {
    return this.#failure;
  }

  async handlePermission(request: PermissionRequest): Promise<void> {
    if (this.#processedRequestIds.has(request.id)) {
      return;
    }
    this.#processedRequestIds.add(request.id);

    if (!this.#onInteractionRequest) {
      this.#failure ??= {
        code: "interaction.permission_required",
        message:
          "interaction.permission_required: OpenCode requested permission without an available OpenMeld interaction channel",
      };
      await this.#client.permission.reply({
        directory: this.#directory,
        message: "OpenMeld could not reach the user for approval.",
        reply: "reject",
        requestID: request.id,
      });
      return;
    }

    const allowOnceOptionId = "opencode-permission-once";
    const allowAlwaysOptionId = "opencode-permission-always";
    const denyOptionId = "opencode-permission-deny";
    const canPersist = request.always.length > 0;
    const options: Extract<
      AdapterInteractionRequest,
      { kind: "permission" }
    >["options"] = [
      {
        intent: "allow_once",
        label: "Allow once",
        optionId: allowOnceOptionId,
      },
      ...(canPersist
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
    const response = await this.#onInteractionRequest({
      ...(formatPermissionDescription(request)
        ? { description: formatPermissionDescription(request) }
        : {}),
      kind: "permission",
      options,
      subject: buildPermissionSubject(request),
      title: buildPermissionTitle(request.permission),
    });
    const optionId =
      response.kind === "permission" ? response.optionId : denyOptionId;
    let reply: "always" | "once" | "reject" = "reject";
    if (optionId === allowOnceOptionId) {
      reply = "once";
    } else if (optionId === allowAlwaysOptionId && canPersist) {
      reply = "always";
    }
    await this.#client.permission.reply({
      directory: this.#directory,
      ...(reply === "reject"
        ? {
            message:
              response.kind === "cancel"
                ? "Cancelled by the user."
                : "Denied by the user.",
          }
        : {}),
      reply,
      requestID: request.id,
    });
  }

  async handleQuestion(request: QuestionRequest): Promise<void> {
    if (this.#processedRequestIds.has(request.id)) {
      return;
    }
    this.#processedRequestIds.add(request.id);

    if (!this.#onInteractionRequest) {
      this.#failure ??= {
        code: "interaction.question_required",
        message:
          "interaction.question_required: OpenCode requested user input without an available OpenMeld interaction channel",
      };
      await this.#client.question.reject({
        directory: this.#directory,
        requestID: request.id,
      });
      return;
    }

    const answers: string[][] = [];
    for (let offset = 0; offset < request.questions.length; offset += 3) {
      const mapped = request.questions
        .slice(offset, offset + 3)
        .map((question, localIndex) =>
          mapQuestion(question, offset + localIndex)
        );
      const response = await this.#onInteractionRequest({
        kind: "question",
        questions: mapped.map(({ request: question }) => question),
        title: "OpenCode needs your input",
      });
      if (response.kind !== "question") {
        await this.#client.question.reject({
          directory: this.#directory,
          requestID: request.id,
        });
        return;
      }
      for (const question of mapped) {
        const answer = response.answers.find(
          (candidate) => candidate.questionId === question.request.questionId
        );
        if (!answer) {
          await this.#client.question.reject({
            directory: this.#directory,
            requestID: request.id,
          });
          return;
        }
        answers.push(
          answer.values.map(
            (value) => question.optionLabelById.get(value) ?? value
          )
        );
      }
    }

    await this.#client.question.reply({
      answers,
      directory: this.#directory,
      requestID: request.id,
    });
  }
}

function mapQuestion(
  question: QuestionRequest["questions"][number],
  index: number
): {
  optionLabelById: ReadonlyMap<string, string>;
  request: Extract<
    AdapterInteractionRequest,
    { kind: "question" }
  >["questions"][number];
} {
  const options = question.options.slice(0, 20).map((option, optionIndex) => ({
    description: normalizeBoundedText(option.description, 1000),
    label:
      normalizeBoundedText(option.label, 240) ?? `Option ${optionIndex + 1}`,
    optionId: `opencode-question-${index + 1}-option-${optionIndex + 1}`,
  }));
  return {
    optionLabelById: new Map(
      options.map((option) => [option.optionId, option.label])
    ),
    request: {
      allowOther: question.custom === true,
      header: normalizeBoundedText(question.header, 120),
      multiple: question.multiple === true,
      options,
      prompt:
        normalizeBoundedText(question.question, 4000) ??
        `OpenCode question ${index + 1}`,
      questionId: `opencode-question-${index + 1}`,
    },
  };
}

function buildPermissionSubject(
  request: PermissionRequest
): Extract<AdapterInteractionRequest, { kind: "permission" }>["subject"] {
  const command = normalizeBoundedText(
    request.metadata.command ??
      request.metadata.cmd ??
      request.metadata.description,
    16_000
  );
  const resource =
    normalizeBoundedText(
      request.patterns.length > 0
        ? request.patterns.join("\n")
        : request.permission,
      4096
    ) ?? request.permission;
  if (request.permission === "bash" || request.permission === "shell") {
    return {
      ...(command ? { command } : {}),
      resource,
      type: "command",
    };
  }
  if (
    request.permission === "edit" ||
    request.permission === "write" ||
    request.permission === "patch"
  ) {
    return {
      resource,
      type: "file_change",
    };
  }
  if (
    request.permission === "external_directory" ||
    request.permission === "external-directory"
  ) {
    return {
      resource,
      type: "additional_permissions",
    };
  }
  return {
    resource,
    type: "tool",
  };
}

function buildPermissionTitle(permission: string): string {
  switch (permission) {
    case "bash":
    case "shell":
      return "Allow OpenCode to run this command?";
    case "edit":
    case "patch":
    case "write":
      return "Allow OpenCode to change these files?";
    case "external_directory":
    case "external-directory":
      return "Allow OpenCode to access this location?";
    default:
      return `Allow OpenCode to use ${permission}?`;
  }
}

function formatPermissionDescription(
  request: PermissionRequest
): string | null {
  const metadataDescription = normalizeBoundedText(
    request.metadata.description,
    4000
  );
  if (metadataDescription) {
    return metadataDescription;
  }
  if (request.patterns.length === 0) {
    return null;
  }
  return normalizeBoundedText(request.patterns.join("\n"), 4000);
}

function normalizeBoundedText(
  value: unknown,
  maxLength: number
): string | null {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized.length > 0 ? normalized.slice(0, maxLength) : null;
}
