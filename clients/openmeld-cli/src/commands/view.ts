import { isCancel, select } from "@clack/prompts";
import {
  getProfileDefaultView,
  setProfileDefaultView,
} from "../config/profile-view";
import { resolveViewProfileKey } from "../config/view-profile-key";
import {
  formatInlineOpenMeldCliCommands,
  formatOpenMeldCliCommands,
} from "../runtime/cli-entry-command";
import { parseCliViewMode, resolveRuntimeContext } from "../runtime/context";
import { canUseInteractivePrompts } from "../runtime/interaction";
import { renderTextInfoCard } from "../ui/info-card";
import { outJsonLine, outLine } from "../ui/io";
import { emitTopLevelCliAgentOverview } from "./top-level-agent-overview";

type ResolvedOutputView = "human" | "agent";
type ViewMode = "auto" | "human" | "agent";
const VIEW_MENU_EXIT = "exit";
type ViewMenuChoice = ViewMode | typeof VIEW_MENU_EXIT;

const VIEW_COPY: Record<
  ViewMode,
  {
    label: string;
    meaning: string;
    menuHint: string;
  }
> = {
  auto: {
    label: "👓 Auto View",
    meaning:
      "OpenMeld chooses for you. Human profiles open Human View. Agent profiles open Agent View.",
    menuHint: "OpenMeld decides for you automatically.",
  },
  human: {
    label: "🙂 Human View",
    meaning: "Guided cards and menus for people.",
    menuHint: "Best when a person is using OpenMeld directly.",
  },
  agent: {
    label: "🤖 Agent View",
    meaning: "Structured output for agents and automation.",
    menuHint: "Best for agents that need machine-readable output.",
  },
};

export async function runViewCommand(input: {
  effectiveView: ResolvedOutputView;
  mode?: string;
  profile?: string;
  interactive?: boolean;
}): Promise<void> {
  const { effectiveView } = input;
  if (effectiveView === "agent") {
    emitTopLevelCliAgentOverview("view");
  }

  const viewOpenMeldProfileId = await resolveViewProfileKey(input.profile);
  const normalized = String(input.mode ?? "")
    .trim()
    .toLowerCase();

  if (!normalized) {
    const current = await readConfiguredDefaultView(viewOpenMeldProfileId);
    if (effectiveView === "agent") {
      emitAgentViewOutput("view.current", current);
      return;
    }

    let switchAvailable = false;
    if (viewOpenMeldProfileId) {
      const runtime = await resolveRuntimeContext({
        view: effectiveView,
        profile: viewOpenMeldProfileId,
        ...(input.interactive === undefined
          ? {}
          : { interactive: input.interactive }),
      });
      switchAvailable = canUseInteractivePrompts(runtime);
    }

    renderCurrentViewCard({
      current,
      profileAvailable: Boolean(viewOpenMeldProfileId),
      switchAvailable,
    });

    if (!(switchAvailable && viewOpenMeldProfileId)) {
      return;
    }

    outLine("");
    const selected = await select<ViewMenuChoice>({
      message: "Switch to a different default view for this OpenMeld profile?",
      options: buildAlternativeViewOptions(current),
    });
    if (isCancel(selected) || selected === VIEW_MENU_EXIT) {
      return;
    }

    await setProfileDefaultView({
      openMeldProfileId: viewOpenMeldProfileId,
      view: selected,
    });
    renderSavedViewCard(selected);
    return;
  }

  const next = parseCliViewMode(normalized);
  if (!viewOpenMeldProfileId) {
    if (effectiveView === "agent") {
      outJsonLine({
        type: "error",
        code: "view.profile_required",
        payload: {
          summary:
            "Saving a default view requires an active OpenMeld profile or an explicit --profile.",
          nextSteps: formatOpenMeldCliCommands([
            "openmeld start",
            "openmeld profile set <profile-id> --view agent",
            "openmeld view <auto|human|agent> --profile <profile-id> --view agent",
          ]),
          humanActionRequired: false,
        },
      });
      process.exitCode = 1;
      return;
    }

    renderProfileRequiredCard({
      requested: next,
    });
    process.exitCode = 1;
    return;
  }

  await setProfileDefaultView({
    openMeldProfileId: viewOpenMeldProfileId,
    view: next,
  });
  if (effectiveView === "agent") {
    emitAgentViewOutput("view.saved", next);
    return;
  }
  renderSavedViewCard(next);
}

function buildAlternativeViewOptions(current: ViewMode) {
  const options: Array<{
    label: string;
    value: ViewMenuChoice;
    hint: string;
  }> = (Object.entries(VIEW_COPY) as [ViewMode, (typeof VIEW_COPY)[ViewMode]][])
    .filter(([mode]) => mode !== current)
    .map(([mode, copy]) => ({
      label: copy.label,
      value: mode,
      hint: copy.menuHint,
    }));

  options.push({
    label: "Exit",
    value: VIEW_MENU_EXIT,
    hint: "Keep the current view and close this menu.",
  });

  return options;
}

function emitAgentViewOutput(
  code: "view.current" | "view.saved",
  current: ViewMode
): void {
  outJsonLine({
    type: "result",
    code,
    payload: {
      current,
    },
  });
}

function renderCurrentViewCard(input: {
  current: ViewMode;
  profileAvailable: boolean;
  switchAvailable: boolean;
}): void {
  const copy = VIEW_COPY[input.current];
  let next = "Pick an OpenMeld profile first to save a default view for it.";
  if (input.profileAvailable) {
    next = input.switchAvailable
      ? "Choose another view below if you want to switch."
      : formatInlineOpenMeldCliCommands(
          "Run `openmeld view <auto|human|agent>` to switch later."
        );
  }

  renderTextInfoCard({
    title: "Current View",
    emitLine: outLine,
    rows: [
      { label: "Status", value: copy.label },
      { label: "Meaning", value: copy.meaning },
      { label: "Next", value: next },
    ],
  });
}

function renderSavedViewCard(current: ViewMode): void {
  const copy = VIEW_COPY[current];
  renderTextInfoCard({
    title: "View Updated",
    emitLine: outLine,
    rows: [
      {
        label: "Status",
        value: `${copy.label} is now the default.`,
      },
      { label: "Meaning", value: copy.meaning },
      {
        label: "Next",
        value: formatInlineOpenMeldCliCommands(
          "You can change it any time with `openmeld view`."
        ),
      },
    ],
  });
}

function renderProfileRequiredCard(input: { requested: ViewMode }): void {
  const copy = VIEW_COPY[input.requested];
  renderTextInfoCard({
    title: "Default View Needs a Profile",
    emitLine: outLine,
    rows: [
      {
        label: "Status",
        value: `${copy.label} could not be saved yet.`,
      },
      {
        label: "Why",
        value:
          "OpenMeld saves the default view per OpenMeld profile, and there is no selected profile in this terminal right now.",
      },
      {
        label: "Next",
        value: formatInlineOpenMeldCliCommands(
          "Run `openmeld start` or `openmeld profile set <profile-id>`, then retry `openmeld view <auto|human|agent>`."
        ),
      },
    ],
  });
}

function readConfiguredDefaultView(
  openMeldProfileId: string | null
): Promise<ViewMode> {
  if (!openMeldProfileId) {
    return Promise.resolve("auto");
  }
  return getProfileDefaultView(openMeldProfileId).catch(() => "auto");
}
