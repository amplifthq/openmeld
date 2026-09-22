import { COMPUTER_FILE_ACCESS_OWNER_CANCELLED_REASON_CODE } from "./schemas/daemon/computer-file-access";
import type {
  AgentInteractionRequest,
  AgentInteractionResponse,
} from "./types";

export const WORKING_FOLDER_RECOVERY_QUESTION_ID =
  "working_folder_recovery" as const;
export const WORKING_FOLDER_RECOVERY_DECLINED =
  "context.workspace_recovery_declined" as const;

export function buildWorkingFolderRecoveryQuestion(input: {
  previousFolderLabel: string;
  selectedFolderLabel: string;
  previousFolder: "available" | "missing" | "restricted";
}): Omit<
  Extract<AgentInteractionRequest, { kind: "question" }>,
  "v" | "interactionId" | "requestedAtMs" | "expiresAtMs"
> {
  let description =
    "This conversation started in a different folder. The task has not started.";
  if (input.previousFolder === "missing") {
    description =
      "The previous conversation’s folder is no longer available. The task has not started.";
  } else if (input.previousFolder === "restricted") {
    description =
      "The previous conversation’s folder is outside this Computer’s allowed folders. The task has not started.";
  }
  return {
    kind: "question",
    title: "Choose where to continue",
    description,
    questions: [
      {
        questionId: WORKING_FOLDER_RECOVERY_QUESTION_ID,
        prompt: "Which conversation should this task use?",
        multiple: false,
        allowOther: false,
        options: [
          ...(input.previousFolder === "available"
            ? [
                {
                  optionId: "use_previous_folder",
                  label: "Continue the previous conversation",
                  description: `Use ${input.previousFolderLabel} for this task. Keep its conversation history. The Agent’s default folder stays unchanged.`,
                },
              ]
            : []),
          {
            optionId: "start_new_conversation",
            label: "Start a new conversation",
            description: `Use ${input.selectedFolderLabel} with the same Agent. The previous conversation stays saved, but its history will not carry over.`,
          },
          {
            optionId: "leave_task",
            label: "Stop this task",
            description: "Keep the previous conversation and folder settings.",
          },
        ],
      },
    ],
  };
}

export function isWorkingFolderRecoveryQuestion(
  request:
    | (Pick<AgentInteractionRequest, "kind"> & {
        questions?: readonly { questionId: string }[];
      })
    | null
): boolean {
  return (
    request?.kind === "question" &&
    request.questions?.length === 1 &&
    request.questions[0]?.questionId === WORKING_FOLDER_RECOVERY_QUESTION_ID
  );
}

export function isWorkingFolderRecoveryDecline(
  response: AgentInteractionResponse
): boolean {
  return (
    response.kind === "question" &&
    response.answers.length === 1 &&
    response.answers[0]?.questionId === WORKING_FOLDER_RECOVERY_QUESTION_ID &&
    response.answers[0].values.length === 1 &&
    response.answers[0].values[0] === "leave_task"
  );
}

/** Only explicit local admission declines qualify; timeouts and lost waiters do not. */
export function resolveLocalExecutionOwnerCancellationReason(payload: {
  status: string;
  errorCode?: string | null;
}): string | null {
  if (payload.status !== "failed") {
    return null;
  }
  return payload.errorCode === WORKING_FOLDER_RECOVERY_DECLINED ||
    payload.errorCode === COMPUTER_FILE_ACCESS_OWNER_CANCELLED_REASON_CODE
    ? payload.errorCode
    : null;
}
