import { cancel, isCancel, note, outro, select } from "@clack/prompts";
import pc from "picocolors";
import type { OpenMeldProfile } from "../config/openmeld-profiles-api";
import { formatInlineOpenMeldCliCommands } from "../runtime/cli-entry-command";
import type { createPresenter } from "../runtime/presenter/index";
import type { RuntimeContext } from "../runtime/types";
import { runSpaceCreate, runSpaceJoin } from "../space/command";
import type { SpaceCommandNavigationStatus } from "../space/navigation-status";
import { buildStartNextActionCommands } from "../start-shell/next-action-commands";
import { promptTextEntry } from "../ui/text-entry";

const START_NEXT_CREATE = "create";
const START_NEXT_JOIN = "join";
const START_NEXT_LATER = "later";
const START_CREATE_GUIDELINES_WRITE = "write";
const START_CREATE_GUIDELINES_SKIP = "skip";
const START_CREATE_GUIDELINES_BACK = "back";
type StartCreateVisibility = "public" | "private";
const START_SPACE_FOLLOW_UP_HINT =
  "Run `openmeld space` any time to create a Space, join one, or manage one later.";

type StartPresenter = ReturnType<typeof createPresenter>;
type StartNextActionResult = "completed" | "cancelled";
type StartSpaceEntryActionInput = {
  presenter: StartPresenter;
  runtime: RuntimeContext;
  gatewayUrl: string;
  profile: OpenMeldProfile;
  interactive: boolean;
  view?: string;
};
type StartNextActionChoice =
  | typeof START_NEXT_CREATE
  | typeof START_NEXT_JOIN
  | typeof START_NEXT_LATER;
type PromptChoiceResult<T> =
  | {
      status: "selected";
      value: T;
    }
  | {
      status: "cancelled";
    }
  | {
      status: "back";
    };

export async function runStartSpaceEntryAction(
  input: StartSpaceEntryActionInput
): Promise<StartNextActionResult> {
  const nextCommands = buildStartNextActionCommands({
    openMeldProfileId: input.profile.openMeldProfileId,
    resolvedView: input.runtime.resolvedView,
  });

  if (input.runtime.resolvedView === "agent") {
    input.presenter.data({
      code: "start.next_actions",
      payload: {
        commands: nextCommands,
      },
    });
    return "completed";
  }

  if (!input.interactive) {
    note(
      ["Run one of the commands below next.", "", ...nextCommands].join("\n"),
      "Next Actions",
      {
        format: (value) => value,
      }
    );
    return "completed";
  }

  for (;;) {
    const nextAction = await promptStartNextActionSelection();
    if (nextAction === null) {
      cancel("Cancelled.");
      return "cancelled";
    }

    const actionResult = await handleInteractiveStartNextActionChoice({
      input,
      nextAction,
    });
    if (actionResult === "back") {
      continue;
    }
    return actionResult;
  }
}

async function promptStartNextActionSelection(): Promise<StartNextActionChoice | null> {
  const nextAction = await select({
    message: [
      "What would you like to do now?",
      pc.dim("A Space is where you talk to people and agents."),
      "",
    ].join("\n"),
    initialValue: START_NEXT_LATER,
    options: [
      {
        value: START_NEXT_CREATE,
        label: "Create a space and join",
      },
      {
        value: START_NEXT_JOIN,
        label: "Join a space",
      },
      {
        value: START_NEXT_LATER,
        label: "Do this later",
      },
    ],
  });

  if (isCancel(nextAction)) {
    return null;
  }
  if (
    nextAction === START_NEXT_CREATE ||
    nextAction === START_NEXT_JOIN ||
    nextAction === START_NEXT_LATER
  ) {
    return nextAction;
  }
  return null;
}

async function handleInteractiveStartNextActionChoice(input: {
  input: StartSpaceEntryActionInput;
  nextAction: StartNextActionChoice;
}): Promise<StartNextActionResult | "back"> {
  if (input.nextAction === START_NEXT_CREATE) {
    const createResult = await runInteractiveStartCreateAction(input.input);
    if (createResult === "back") {
      return "back";
    }
    return createResult === "cancelled" ? "cancelled" : "completed";
  }

  if (input.nextAction === START_NEXT_JOIN) {
    const joinResult = await runInteractiveStartJoinAction(input.input);
    if (joinResult === "back") {
      return "back";
    }
    return joinResult === "cancelled" ? "cancelled" : "completed";
  }

  emitStartSpaceHint(input.input.presenter);
  return "completed";
}

function emitStartSpaceHint(presenter: StartPresenter): void {
  outro("You're set up.");
  presenter.line({
    code: "start.next_actions.space_hint",
    text: pc.dim(formatInlineOpenMeldCliCommands(START_SPACE_FOLLOW_UP_HINT)),
  });
}

async function runInteractiveStartCreateAction(input: {
  runtime: RuntimeContext;
  gatewayUrl: string;
  profile: OpenMeldProfile;
  view?: string;
}): Promise<SpaceCommandNavigationStatus> {
  const followupView =
    input.runtime.resolvedView === "human" ? "human" : input.view;
  const createInput = await promptCreateSpaceInputForStart();
  if (createInput.status === "cancelled") {
    cancel("Cancelled.");
    return "cancelled";
  }
  if (createInput.status === "back") {
    return "back";
  }

  return await runSpaceCreate({
    profile: input.profile.openMeldProfileId,
    baseUrl: input.gatewayUrl,
    name: createInput.name,
    visibility: createInput.visibility,
    guide: createInput.guide,
    guidePromptHandled: true,
    join: true,
    output: "text",
    view: followupView,
    entryChecksHandled: true,
  });
}

function runInteractiveStartJoinAction(input: {
  runtime: RuntimeContext;
  gatewayUrl: string;
  profile: OpenMeldProfile;
  view?: string;
}): Promise<SpaceCommandNavigationStatus> {
  const followupView =
    input.runtime.resolvedView === "human" ? "human" : input.view;
  return runSpaceJoin({
    profile: input.profile.openMeldProfileId,
    baseUrl: input.gatewayUrl,
    output: "text",
    view: followupView,
    allowPrompt: true,
    entryChecksHandled: true,
  });
}

async function promptCreateSpaceInputForStart(): Promise<
  | {
      status: "submitted";
      name: string;
      visibility: StartCreateVisibility;
      guide?: string;
    }
  | { status: "back" }
  | { status: "cancelled" }
> {
  for (;;) {
    const nameInput = await promptTextEntry({
      message: "Space name",
      placeholder: "e.g. spaceship",
      allowBack: true,
      requiredMessage: "Space name cannot be empty.",
    });
    if (nameInput.status === "cancelled") {
      return { status: "cancelled" };
    }
    if (nameInput.status === "back") {
      return { status: "back" };
    }
    const name = nameInput.value;
    const visibility = await promptStartSpaceVisibility();
    if (visibility.status === "back") {
      continue;
    }
    if (visibility.status === "cancelled") {
      return visibility;
    }
    const guideInput = await promptStartSpaceGuide();
    if (guideInput.status === "back") {
      continue;
    }
    if (guideInput.status === "cancelled") {
      return guideInput;
    }
    if (guideInput.status !== "submitted") {
      continue;
    }
    return {
      status: "submitted",
      name,
      visibility: visibility.value,
      ...(guideInput.guide ? { guide: guideInput.guide } : {}),
    };
  }
}

async function promptStartSpaceVisibility(): Promise<
  | {
      status: "submitted";
      value: StartCreateVisibility;
    }
  | { status: "back" }
  | { status: "cancelled" }
> {
  const action = await select({
    message: "Organization visibility",
    options: [
      {
        value: "private",
        label: "Private to this organization",
      },
      {
        value: "public",
        label: "Visible to the organization directory",
      },
      {
        value: "back",
        label: "Back",
      },
    ],
    initialValue: "private",
  });
  if (isCancel(action)) {
    return { status: "cancelled" };
  }
  if (action === "back") {
    return { status: "back" };
  }
  if (action === "private" || action === "public") {
    return {
      status: "submitted",
      value: action,
    };
  }
  return { status: "cancelled" };
}

async function promptStartSpaceGuide(): Promise<
  | {
      status: "submitted";
      guide?: string;
    }
  | { status: "back" | "cancelled" }
> {
  while (true) {
    const guideMode = await promptCreateSpaceGuideChoice();
    if (guideMode.status === "cancelled") {
      return { status: "cancelled" };
    }
    if (guideMode.status === "back") {
      return { status: "back" };
    }
    if (guideMode.value === START_CREATE_GUIDELINES_SKIP) {
      return {
        status: "submitted",
      };
    }

    const guideInput = await promptTextEntry({
      message: "Space guide",
      placeholder: "e.g. Keep it concise, respectful, and actionable.",
      allowBack: true,
      requiredMessage: "Space guide cannot be empty.",
    });
    if (guideInput.status === "back") {
      continue;
    }
    if (guideInput.status === "cancelled") {
      return { status: "cancelled" };
    }
    return {
      status: "submitted",
      guide: guideInput.value,
    };
  }
}

async function promptCreateSpaceGuideChoice(): Promise<
  PromptChoiceResult<
    typeof START_CREATE_GUIDELINES_WRITE | typeof START_CREATE_GUIDELINES_SKIP
  >
> {
  const choice = await select({
    message: "Space guide (optional)",
    options: [
      {
        value: START_CREATE_GUIDELINES_WRITE,
        label: "Add guide",
        hint: "Write rules or expectations for this space",
      },
      {
        value: START_CREATE_GUIDELINES_SKIP,
        label: "Skip for now",
        hint: "Create the space without extra guide",
      },
      {
        value: START_CREATE_GUIDELINES_BACK,
        label: "Back",
      },
    ],
  });

  if (isCancel(choice)) {
    return { status: "cancelled" };
  }
  if (choice === START_CREATE_GUIDELINES_BACK) {
    return { status: "back" };
  }
  if (
    choice === START_CREATE_GUIDELINES_WRITE ||
    choice === START_CREATE_GUIDELINES_SKIP
  ) {
    return {
      status: "selected",
      value: choice,
    };
  }

  return {
    status: "cancelled",
  };
}
