import { cancel, confirm, isCancel, multiselect, select } from "@clack/prompts";
import type {
  PatchSpaceContractBody,
  SpaceContract,
} from "@openmeld/schemas/types";
import {
  SPACE_CONTRACT_ALLOWED_ACTION_VALUES,
  SPACE_CONTRACT_BRIEF_MODE_VALUES,
  SPACE_CONTRACT_DISPATCH_POLICY_VALUES,
  SPACE_CONTRACT_PUBLICATION_MODE_VALUES,
  SPACE_CONTRACT_RESULT_ARCHIVE_MODE_VALUES,
} from "./contract-set-options";

export async function runSpaceContractSetFlow(input: {
  currentContract: SpaceContract;
}): Promise<
  | {
      status: "completed";
      contractPatch: PatchSpaceContractBody;
    }
  | { status: "cancelled" }
> {
  const dispatchPolicyMode = await select({
    message: "Dispatch mode",
    initialValue: input.currentContract.dispatchPolicy.mode,
    options: [
      {
        value: SPACE_CONTRACT_DISPATCH_POLICY_VALUES[0],
        label: "Mention only",
        hint: "Dispatch when mentioned",
      },
      {
        value: SPACE_CONTRACT_DISPATCH_POLICY_VALUES[1],
        label: "Listen to all",
        hint: "Dispatch on all new messages",
      },
    ],
  });
  if (isCancel(dispatchPolicyMode)) {
    cancel("Cancelled.");
    return { status: "cancelled" };
  }

  const publicationMode = await select({
    message: "Publication mode",
    initialValue: input.currentContract.publicationMode,
    options: [
      {
        value: SPACE_CONTRACT_PUBLICATION_MODE_VALUES[0],
        label: "Collaboration",
        hint: "Explicit public actions only",
      },
      {
        value: SPACE_CONTRACT_PUBLICATION_MODE_VALUES[1],
        label: "Transparent",
        hint: "Share raw successful replies when no action is chosen",
      },
    ],
  });
  if (isCancel(publicationMode)) {
    cancel("Cancelled.");
    return { status: "cancelled" };
  }

  const allowedActions = await multiselect({
    message: "Allowed actions",
    required: true,
    initialValues: [...input.currentContract.allowedActions],
    options: [
      {
        value: SPACE_CONTRACT_ALLOWED_ACTION_VALUES[0],
        label: "post_message",
        hint: "Publish a normal message",
      },
      {
        value: SPACE_CONTRACT_ALLOWED_ACTION_VALUES[1],
        label: "post_status",
        hint: "Publish a status bubble",
      },
      {
        value: SPACE_CONTRACT_ALLOWED_ACTION_VALUES[2],
        label: "stay_silent",
        hint: "Let system record a silent decision",
      },
    ],
  });
  if (isCancel(allowedActions)) {
    cancel("Cancelled.");
    return { status: "cancelled" };
  }

  const resultArchiveMode = await select({
    message: "Result archive",
    initialValue: input.currentContract.resultArchivePolicy.mode,
    options: [
      {
        value: SPACE_CONTRACT_RESULT_ARCHIVE_MODE_VALUES[0],
        label: "none",
        hint: "Do not archive dispatch results",
      },
      {
        value: SPACE_CONTRACT_RESULT_ARCHIVE_MODE_VALUES[1],
        label: "space_reply_only",
        hint: "Archive only public space replies",
      },
      {
        value: SPACE_CONTRACT_RESULT_ARCHIVE_MODE_VALUES[2],
        label: "all_final_results",
        hint: "Archive every final dispatch outcome (advanced)",
      },
    ],
  });
  if (isCancel(resultArchiveMode)) {
    cancel("Cancelled.");
    return { status: "cancelled" };
  }

  const entryBrief = await select({
    message: "Space Entry Brief",
    initialValue: input.currentContract.entryBrief,
    options: SPACE_CONTRACT_BRIEF_MODE_VALUES.map((value) => ({
      value,
      label: value,
    })),
  });
  if (isCancel(entryBrief)) {
    cancel("Cancelled.");
    return { status: "cancelled" };
  }

  const dispatchBrief = await select({
    message: "Space Dispatch Brief",
    initialValue: input.currentContract.dispatchBrief,
    options: SPACE_CONTRACT_BRIEF_MODE_VALUES.map((value) => ({
      value,
      label: value,
    })),
  });
  if (isCancel(dispatchBrief)) {
    cancel("Cancelled.");
    return { status: "cancelled" };
  }

  const confirmed = await confirm({
    message: "Apply these contract changes?",
    initialValue: true,
  });
  if (isCancel(confirmed) || confirmed !== true) {
    cancel("Cancelled.");
    return { status: "cancelled" };
  }

  return {
    status: "completed",
    contractPatch: {
      dispatchPolicy: { mode: dispatchPolicyMode },
      publicationMode,
      allowedActions,
      resultArchivePolicy: { mode: resultArchiveMode },
      entryBrief,
      dispatchBrief,
    },
  };
}
