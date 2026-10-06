import type {
  FormAnswer,
  FormField,
  FormInfo,
  PermissionRequest,
} from "@opencode/client";
import type {
  AdapterInteractionCallback,
  AdapterInteractionRequest,
} from "@openmeld/adapter-core";
import { type OpenCode2Client, openCode2Error } from "./opencode2-server.js";

export async function answerOpenCode2Permission(
  client: OpenCode2Client,
  request: PermissionRequest,
  onInteractionRequest?: AdapterInteractionCallback,
  signal?: AbortSignal
) {
  const options: Extract<
    AdapterInteractionRequest,
    { kind: "permission" }
  >["options"] = [
    { optionId: "once", label: "Allow once", intent: "allow_once" },
    ...(request.save?.length
      ? [
          {
            optionId: "always",
            label: "Always allow",
            intent: "allow_always" as const,
          },
        ]
      : []),
    { optionId: "reject", label: "Deny", intent: "deny" },
  ];
  const response = onInteractionRequest
    ? await requestInteraction(
        onInteractionRequest,
        {
          kind: "permission",
          title: "OpenCode needs permission",
          description: (
            request.message ||
            `${request.action}: ${request.resources.join(", ")}`
          ).slice(0, 4000),
          subject: { type: permissionSubject(request.action) },
          options,
        },
        signal
      )
    : undefined;
  const selected =
    response?.kind === "permission" &&
    options.some((option) => option.optionId === response.optionId)
      ? response.optionId
      : "reject";
  await client.permission.reply(
    {
      sessionID: request.sessionID,
      requestID: request.id,
      decision: selected as "once" | "always" | "reject",
    },
    { signal }
  );
  if (!onInteractionRequest) {
    throw openCode2Error(
      "interaction.permission_required",
      "OpenCode requested permission without a user interaction channel."
    );
  }
}

export async function answerOpenCode2Form(
  client: OpenCode2Client,
  form: FormInfo,
  onInteractionRequest?: AdapterInteractionCallback,
  signal?: AbortSignal
) {
  const answer: FormAnswer = {};
  try {
    if (!onInteractionRequest) {
      throw openCode2Error(
        "interaction.question_required",
        "OpenCode requested input without a user interaction channel."
      );
    }
    // Ask in native field order so conditional fields use the answers above them.
    for (const field of form.fields) {
      if (field.type === "external") {
        throw openCode2Error(
          "interaction.question_unsupported",
          "This OpenCode form requires an external browser action."
        );
      }
      if (
        field.when?.some(
          (condition) =>
            (answer[condition.key] === condition.value) !==
            (condition.op === "eq")
        )
      ) {
        continue;
      }
      if (applyHiddenField(field, answer)) {
        continue;
      }
      const options = fieldOptions(field);
      if (options.length > 20) {
        throw openCode2Error(
          "interaction.question_unsupported",
          "The OpenCode form has too many choices."
        );
      }
      if (field.key.length > 256) {
        throw openCode2Error(
          "interaction.question_unsupported",
          "The OpenCode field identifier is too long."
        );
      }
      const response = await requestInteraction(
        onInteractionRequest,
        {
          kind: "question",
          title: form.title.slice(0, 240),
          questions: [
            {
              questionId: field.key,
              prompt: [field.title || field.key, field.description]
                .filter(Boolean)
                .join("\n")
                .slice(0, 4000),
              options,
              multiple: field.type === "multiselect",
              allowOther:
                options.length === 0 ||
                ("custom" in field && field.custom === true),
            },
          ],
        },
        signal
      );
      if (response.kind !== "question") {
        await client.session.form.cancel(
          { sessionID: form.sessionID, formID: form.id },
          { signal }
        );
        return;
      }
      const values = response.answers.find(
        (item) => item.questionId === field.key
      )?.values;
      if (!values?.length) {
        throw openCode2Error(
          "interaction.response_invalid",
          "The form answer is missing."
        );
      }
      answer[field.key] = decodeField(field, values);
    }
    await client.session.form.reply(
      { sessionID: form.sessionID, formID: form.id, answer },
      { signal }
    );
  } catch (error) {
    await client.session.form
      .cancel({ sessionID: form.sessionID, formID: form.id }, { signal })
      .catch(() => undefined);
    throw error;
  }
}

async function requestInteraction(
  callback: AdapterInteractionCallback,
  request: AdapterInteractionRequest,
  signal?: AbortSignal
) {
  signal?.throwIfAborted();
  if (!signal) {
    return await callback(request);
  }
  const stopped = Promise.withResolvers<never>();
  const onAbort = () => stopped.reject(signal.reason);
  signal.addEventListener("abort", onAbort, { once: true });
  try {
    return await Promise.race([callback(request), stopped.promise]);
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}

function decodeField(
  field: Exclude<FormField, { type: "external" }>,
  values: string[]
): FormAnswer[string] {
  if (field.type !== "multiselect" && values.length !== 1) {
    throw openCode2Error(
      "interaction.response_invalid",
      "This field requires one answer."
    );
  }
  if (field.type === "boolean") {
    if (values[0] !== "true" && values[0] !== "false") {
      throw openCode2Error(
        "interaction.response_invalid",
        "A boolean answer must be Yes or No."
      );
    }
    return values[0] === "true";
  }
  if (field.type === "number" || field.type === "integer") {
    const value = Number(values[0]);
    if (
      !Number.isFinite(value) ||
      (field.type === "integer" && !Number.isInteger(value)) ||
      (typeof field.minimum === "number" && value < field.minimum) ||
      (typeof field.maximum === "number" && value > field.maximum)
    ) {
      throw openCode2Error(
        "interaction.response_invalid",
        "The number is outside the requested range."
      );
    }
    return value;
  }
  const resolved = values.map((value) => {
    const option = field.options?.find(
      (_item, index) => String(index) === value
    );
    if (option) {
      return option.value;
    }
    if (field.options?.length && !field.custom) {
      throw openCode2Error(
        "interaction.response_invalid",
        "The selected choice is unavailable."
      );
    }
    return value;
  });
  // The native reply endpoint independently validates string and list constraints.
  if (field.type === "multiselect") {
    return resolved;
  }
  const first = resolved[0];
  if (first === undefined) {
    throw openCode2Error(
      "interaction.response_invalid",
      "The form answer is missing."
    );
  }
  return first;
}

function permissionSubject(action: string): "command" | "file_change" | "tool" {
  if (action === "shell") {
    return "command";
  }
  return action === "edit" ? "file_change" : "tool";
}

function applyHiddenField(
  field: Exclude<FormField, { type: "external" }>,
  answer: FormAnswer
): boolean {
  if (!field.hidden) {
    return false;
  }
  if (field.default !== undefined) {
    answer[field.key] = field.default;
  } else if (field.required) {
    throw openCode2Error(
      "interaction.question_unsupported",
      "A hidden required field has no default."
    );
  }
  return true;
}

function fieldOptions(field: Exclude<FormField, { type: "external" }>) {
  if (field.type === "boolean") {
    return [
      { optionId: "true", label: "Yes" },
      { optionId: "false", label: "No" },
    ];
  }
  if (!("options" in field)) {
    return [];
  }
  return (field.options ?? []).map((option, index) => ({
    optionId: String(index),
    label: option.label.slice(0, 240),
    ...(option.description
      ? { description: option.description.slice(0, 1000) }
      : {}),
  }));
}
