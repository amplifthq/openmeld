import { cancel, isCancel, outro, select } from "@clack/prompts";
import {
  buildCommandAuthenticationPromptMessage,
  ensureCommandAuthenticationOrCancel,
} from "../auth/command-auth";
import { resolveBaseUrl } from "../config/base-url";
import { resolveRuntimeContext } from "../runtime/context";
import { createSpaceMenuGuideError } from "../runtime/dual-view-guide-catalog";
import { canUseInteractivePrompts } from "../runtime/interaction";
import { formatMessage } from "../runtime/messages";
import { createPresenter } from "../runtime/presenter";
import { promptTextEntry } from "../ui/text-entry";
import { emitSpaceAgentOverview } from "./agent-overview";
import {
  buildCreateSpacePasswordPromptConfig,
  promptAndConfirmSpacePassword,
  runSpaceAddMembers,
  runSpaceCreate,
  runSpaceDelete,
  runSpaceJoin,
  runSpaceLeave,
  runSpacePassword,
  runSpaceRemoveMembers,
} from "./command";
import type { SpaceCommandNavigationStatus } from "./navigation-status";

type SpaceMenuAction =
  | "join"
  | "create"
  | "add_members"
  | "remove_members"
  | "leave"
  | "configure"
  | "delete"
  | "exit";

type SpaceMenuActionOutcome = "continue" | "done" | "cancelled";
type SpaceMenuNestedCommandResult = SpaceCommandNavigationStatus;
type SpaceMenuCreateVisibility = "public" | "private";

export async function runSpaceMenu(input: {
  profile?: string;
  baseUrl?: string;
  view?: string;
  entryChecksHandled?: boolean;
}) {
  const runtime = await resolveRuntimeContext({
    profile: input.profile,
    view: input.view,
  });
  const presenter = createPresenter(runtime);
  emitSpaceAgentOverview({
    presenter,
    resolvedView: runtime.resolvedView,
    command: "menu",
  });

  if (!canUseInteractivePrompts(runtime)) {
    if (runtime.resolvedView === "agent") {
      throw createSpaceMenuGuideError();
    }
    throw new Error(
      formatMessage(runtime.resolvedView, "space.menu.interactive_required")
    );
  }
  const hasExplicitBaseUrlInput = String(input.baseUrl ?? "").trim().length > 0;
  const baseUrl = await resolveBaseUrl(input.baseUrl);
  if (!input.entryChecksHandled) {
    const authReady = await ensureCommandAuthenticationOrCancel({
      runtime,
      ...(hasExplicitBaseUrlInput ? { gatewayUrl: baseUrl } : {}),
      promptMessage: buildCommandAuthenticationPromptMessage("managing spaces"),
      allowPrompt: true,
    });
    if (!authReady) {
      return;
    }
  }

  for (;;) {
    const action = await promptSpaceMenuAction();
    if (!action) {
      cancel("Cancelled.");
      return;
    }

    if (action === "exit") {
      outro("Done.");
      return;
    }

    const outcome = await handleSpaceMenuAction({
      action,
      profile: input.profile,
      baseUrl: input.baseUrl,
      view: input.view,
    });
    if (outcome === "continue") {
      continue;
    }
    if (outcome === "cancelled") {
      return;
    }
    return;
  }
}

async function promptSpaceMenuAction(): Promise<SpaceMenuAction | null> {
  const action = await select({
    message: "What do you want to do?",
    options: [
      {
        value: "join",
        label: "Join a space",
        hint: "Start chatting in a space",
      },
      {
        value: "create",
        label: "Create a space",
        hint: "Create now and optionally join",
      },
      {
        value: "add_members",
        label: "Add members",
        hint: "Add your other profiles to a space",
      },
      {
        value: "remove_members",
        label: "Remove members",
        hint: "Remove your managed members from a space",
      },
      {
        value: "leave",
        label: "Leave a space",
        hint: "Remove the current profile from a space",
      },
      {
        value: "configure",
        label: "Configure a space",
        hint: "Update space settings (starting with password)",
      },
      {
        value: "delete",
        label: "Delete spaces",
        hint: "Permanently delete one or more spaces you are authorized to remove",
      },
      { value: "exit", label: "Exit" },
    ],
  });
  if (isCancel(action)) {
    return null;
  }
  return action;
}

async function handleSpaceMenuAction(input: {
  action: Exclude<SpaceMenuAction, "exit">;
  profile?: string;
  baseUrl?: string;
  view?: string;
}): Promise<SpaceMenuActionOutcome> {
  if (input.action === "join") {
    const result = await runSpaceJoin({
      profile: input.profile,
      baseUrl: input.baseUrl,
      output: "text",
      view: input.view,
      entryChecksHandled: true,
    });
    return result === "back" ? "continue" : "done";
  }

  if (input.action === "delete") {
    const result = await runSpaceDelete({
      profile: input.profile,
      baseUrl: input.baseUrl,
      view: input.view,
      entryChecksHandled: true,
      allowBackToCaller: true,
    });
    return resolveSpaceMenuNestedOutcome(result);
  }

  if (input.action === "add_members") {
    const result = await runSpaceAddMembers({
      profile: input.profile,
      baseUrl: input.baseUrl,
      view: input.view,
      entryChecksHandled: true,
      allowBackToCaller: true,
      membershipSource: "organization_directory",
    });
    return resolveSpaceMenuNestedOutcome(result);
  }

  if (input.action === "remove_members") {
    const result = await runSpaceRemoveMembers({
      profile: input.profile,
      baseUrl: input.baseUrl,
      view: input.view,
      entryChecksHandled: true,
      allowBackToCaller: true,
    });
    return resolveSpaceMenuNestedOutcome(result);
  }

  if (input.action === "leave") {
    const result = await runSpaceLeave({
      profile: input.profile,
      baseUrl: input.baseUrl,
      view: input.view,
      entryChecksHandled: true,
      allowBackToCaller: true,
    });
    return resolveSpaceMenuNestedOutcome(result);
  }

  if (input.action === "configure") {
    const result = await runSpaceConfigMenu({
      profile: input.profile,
      baseUrl: input.baseUrl,
      view: input.view,
    });
    return resolveSpaceMenuNestedOutcome(result);
  }

  const createInput = await promptSpaceMenuCreateInput();
  if (createInput.status === "back") {
    return "continue";
  }
  if (createInput.status === "cancelled") {
    return "cancelled";
  }

  const result = await runSpaceCreate({
    profile: input.profile,
    baseUrl: input.baseUrl,
    name: createInput.value.name,
    visibility: createInput.value.visibility,
    guide: createInput.value.guide,
    password: createInput.value.password,
    join: createInput.value.join,
    output: "text",
    view: input.view,
    entryChecksHandled: true,
  });
  return resolveSpaceMenuNestedOutcome(result);
}

async function runSpaceConfigMenu(input: {
  profile?: string;
  baseUrl?: string;
  view?: string;
}): Promise<SpaceMenuNestedCommandResult> {
  for (;;) {
    const configAction = await select({
      message: "What do you want to configure?",
      options: [
        {
          value: "password",
          label: "Password",
          hint: "Set, reset, or clear password protection",
        },
        { value: "back", label: "Back" },
      ],
    });
    if (isCancel(configAction)) {
      cancel("Cancelled.");
      return "cancelled";
    }
    if (configAction === "back") {
      return "back";
    }

    const result = await runSpacePassword({
      profile: input.profile,
      baseUrl: input.baseUrl,
      view: input.view,
      entryChecksHandled: true,
      allowBackToCaller: true,
    });
    if (result === "back") {
      continue;
    }
    return result;
  }
}

function resolveSpaceMenuNestedOutcome(
  result: SpaceMenuNestedCommandResult
): SpaceMenuActionOutcome {
  if (result === "back") {
    return "continue";
  }
  if (result === "cancelled") {
    return "cancelled";
  }
  return "done";
}

async function promptRequiredSpaceName(input?: {
  allowBack?: boolean;
}): Promise<
  | { status: "submitted"; value: string }
  | { status: "back" }
  | { status: "cancelled" }
> {
  for (;;) {
    const nameInput = await promptTextEntry({
      message: "Space name",
      placeholder: "e.g. spaceship",
      allowBack: input?.allowBack === true,
      backLabel: "Back",
      validate: (value) =>
        value.trim().length > 0 ? null : "Space name cannot be empty.",
    });
    if (nameInput.status !== "submitted") {
      return nameInput;
    }
    return {
      status: "submitted",
      value: nameInput.value.trim(),
    };
  }
}

async function promptSpaceMenuGuide(): Promise<
  | { status: "submitted"; value: string | undefined }
  | { status: "back" }
  | { status: "cancelled" }
> {
  const result = await promptTextEntry({
    message: "Space guide (optional)",
    placeholder: "e.g. Keep it concise, respectful, and actionable.",
    allowBack: true,
    allowEmpty: true,
    backLabel: "Back",
  });
  if (result.status !== "submitted") {
    return result;
  }

  const value = result.value.trim();
  return {
    status: "submitted",
    value: value.length > 0 ? value : undefined,
  };
}

async function promptSpaceMenuCreatePassword(): Promise<
  | { status: "submitted"; value: string | undefined }
  | { status: "back" }
  | { status: "cancelled" }
> {
  for (;;) {
    const promptConfig = buildCreateSpacePasswordPromptConfig();
    const action = await select({
      message: promptConfig.message,
      options: [
        {
          value: "set",
          label: promptConfig.setPasswordLabel,
        },
        {
          value: "skip",
          label: promptConfig.skipPasswordLabel,
        },
        {
          value: "back",
          label: "Back",
        },
      ],
    });
    if (isCancel(action)) {
      return { status: "cancelled" };
    }
    if (action === "back") {
      return { status: "back" };
    }
    if (action === "skip") {
      return {
        status: "submitted",
        value: undefined,
      };
    }

    const password = await promptAndConfirmSpacePassword({
      allowBack: true,
      emitCancelMessage: false,
    });
    if (password.status === "cancelled") {
      return password;
    }
    if (password.status === "back") {
      continue;
    }
    return {
      status: "submitted",
      value: password.value,
    };
  }
}

async function promptSpaceMenuJoinAfterCreate(): Promise<
  | { status: "submitted"; value: boolean }
  | { status: "back" }
  | { status: "cancelled" }
> {
  const action = await select({
    message: "Join this space now?",
    options: [
      {
        value: "join",
        label: "Yes",
      },
      {
        value: "skip",
        label: "No",
      },
      {
        value: "back",
        label: "Back",
      },
    ],
    initialValue: "join",
  });
  if (isCancel(action)) {
    return { status: "cancelled" };
  }
  if (action === "back") {
    return { status: "back" };
  }
  return {
    status: "submitted",
    value: action === "join",
  };
}

function cancelSpaceMenuFlow(): { status: "cancelled" } {
  cancel("Cancelled.");
  return { status: "cancelled" };
}

async function promptSpaceMenuCreateVisibility(): Promise<
  | { status: "submitted"; value: SpaceMenuCreateVisibility }
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

async function promptSpaceMenuCreateDetails(input: { name: string }): Promise<
  | {
      status: "submitted";
      value: {
        name: string;
        visibility: SpaceMenuCreateVisibility;
        guide?: string;
        password?: string;
        join: boolean;
      };
    }
  | { status: "back" }
  | { status: "cancelled" }
> {
  for (;;) {
    const visibility = await promptSpaceMenuCreateVisibility();
    if (visibility.status === "cancelled") {
      return cancelSpaceMenuFlow();
    }
    if (visibility.status === "back") {
      return { status: "back" };
    }

    const guide = await promptSpaceMenuGuide();
    if (guide.status === "cancelled") {
      return cancelSpaceMenuFlow();
    }
    if (guide.status === "back") {
      return { status: "back" };
    }

    const createOptions = await promptSpaceMenuCreateOptions({
      name: input.name,
      visibility: visibility.value,
      guide: guide.value,
    });
    if (createOptions.status === "back") {
      continue;
    }
    return createOptions;
  }
}

async function promptSpaceMenuCreateOptions(input: {
  name: string;
  visibility: SpaceMenuCreateVisibility;
  guide?: string;
}): Promise<
  | {
      status: "submitted";
      value: {
        name: string;
        visibility: SpaceMenuCreateVisibility;
        guide?: string;
        password?: string;
        join: boolean;
      };
    }
  | { status: "back" }
  | { status: "cancelled" }
> {
  for (;;) {
    const password = await promptSpaceMenuCreatePassword();
    if (password.status === "cancelled") {
      return cancelSpaceMenuFlow();
    }
    if (password.status === "back") {
      return { status: "back" };
    }

    const join = await promptSpaceMenuJoinAfterCreate();
    if (join.status === "cancelled") {
      return cancelSpaceMenuFlow();
    }
    if (join.status === "back") {
      continue;
    }

    return {
      status: "submitted",
      value: {
        name: input.name,
        visibility: input.visibility,
        guide: input.guide,
        password: password.value,
        join: join.value,
      },
    };
  }
}

async function promptSpaceMenuCreateInput(): Promise<
  | {
      status: "submitted";
      value: {
        name: string;
        visibility: SpaceMenuCreateVisibility;
        guide?: string;
        password?: string;
        join: boolean;
      };
    }
  | { status: "back" }
  | { status: "cancelled" }
> {
  for (;;) {
    const name = await promptRequiredSpaceName({ allowBack: true });
    if (name.status !== "submitted") {
      return name.status === "cancelled" ? cancelSpaceMenuFlow() : name;
    }

    const details = await promptSpaceMenuCreateDetails({
      name: name.value,
    });
    if (details.status === "back") {
      continue;
    }
    return details;
  }
}
