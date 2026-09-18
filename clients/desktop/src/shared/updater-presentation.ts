import type {
  DesktopUpdaterAction,
  DesktopUpdaterState,
} from "@openmeld/schemas";

type NoticePolicy = "none" | "dismissible" | "required";
type UpdateDescription = {
  headline: string;
  description: string;
  action?: DesktopUpdaterAction;
  label?: string;
  attention?: boolean;
  notice?: NoticePolicy;
};

/** A projection of Main's facts, never a second updater state machine. */
export function desktopUpdaterPresentation(state: DesktopUpdaterState | null) {
  const description = describeUpdate(state);
  const sentence = description.headline.endsWith("…")
    ? description.headline
    : `${description.headline}.`;
  const progress =
    state?.status === "downloading" && state.percent !== null
      ? ` ${Math.round(state.percent)}%`
      : "";
  return {
    action: undefined as DesktopUpdaterAction | undefined,
    label: undefined as string | undefined,
    attention: false,
    notice: "none" as NoticePolicy,
    ...description,
    busy:
      !state ||
      ["checking", "downloading", "preparing", "installing"].includes(
        state.status
      ),
    // Notices keep one heading, but must not drop an error's cause or safety copy.
    noticeMessage:
      state?.status === "error" || description.notice === "required"
        ? `${sentence} ${description.description}`
        : description.description,
    // Native dialogs do not render the React heading: keep a complete message.
    message: `${sentence} ${description.description}${progress}`.trim(),
    // Neither progress ticks nor repeated checks create another interruption.
    noticeKey:
      state && description.notice === "dismissible"
        ? JSON.stringify([
            state.version,
            state.status,
            state.status === "error" ? (state.errorStage ?? "check") : null,
          ])
        : null,
  };
}

function describeUpdate(state: DesktopUpdaterState | null): UpdateDescription {
  if (!state) {
    return {
      headline: "Loading update status…",
      description: "Reading the Desktop update status.",
    };
  }
  switch (state.status) {
    case "idle":
      return {
        headline: "Check for updates",
        description: "Check for a newer version of OpenMeld Desktop.",
        action: "check",
        label: "Check for updates",
      };
    case "current":
      return {
        headline: "You're up to date",
        description: "No updates are available.",
        action: "check",
        label: "Check for updates",
      };
    case "checking":
      return {
        headline: "Checking for updates…",
        description: "Looking for a newer version of OpenMeld Desktop.",
        attention: state.version !== null,
      };
    case "available":
      return {
        headline: "Update available",
        description: state.version
          ? `Version ${state.version} is available to download.`
          : "An update is available to download.",
        action: "download",
        label: "Download update",
        attention: true,
        notice: "dismissible",
      };
    case "downloading":
      return {
        headline: "Downloading update…",
        description: state.version
          ? `Downloading version ${state.version}.`
          : "The update is downloading.",
        attention: true,
        notice: "dismissible",
      };
    case "downloaded":
      return {
        headline: "Ready to restart",
        description: `${state.version ? `Version ${state.version} is downloaded.` : "The update is downloaded."} Restart to finish updating.`,
        action: "restart",
        label: "Restart to update",
        attention: true,
        notice: "dismissible",
      };
    case "preparing":
      return {
        headline: "Saving before restart…",
        description:
          "Checking that your work is saved before updating Desktop.",
        notice: "required",
      };
    case "installing":
      return {
        headline: "Restarting to update…",
        description: state.version
          ? `Installing version ${state.version}. Editing is paused during the update.`
          : "Installing the update. Editing is paused during the update.",
        notice: "required",
      };
    case "unavailable":
      return {
        headline: "Updates aren't available in this build",
        description: "Updates are available in the installed production app.",
      };
    case "error":
      return describeError(state);
    default: {
      // Adding a native status must include an explicit, reviewed presentation.
      const unsupported: never = state.status;
      throw new Error(`Unsupported Desktop update status: ${unsupported}`);
    }
  }
}

function describeError(state: DesktopUpdaterState): UpdateDescription {
  switch (state.errorStage) {
    case "install":
      return {
        headline: "Update couldn't finish",
        description:
          "Editing is paused to protect your saved work. Choose Quit from the app menu, then reopen Desktop. The update may finish when you quit.",
        notice: "required",
      };
    case "restart":
      return {
        headline: "Couldn't restart",
        description:
          "Finish pending uploads and sends, save your changes, then try again.",
        action: "restart",
        label: "Retry restart",
        attention: true,
        notice: "dismissible",
      };
    case "download":
      return {
        headline: "Couldn't download the update",
        description: state.version
          ? `Version ${state.version} hasn't finished downloading. Check your connection and try again.`
          : "Check your connection and try again.",
        action: "download",
        label: "Retry download",
        attention: true,
        notice: "dismissible",
      };
    case "check":
    case null:
      return {
        headline: "Couldn't check for updates",
        description: "Check your connection and try again.",
        action: "check",
        label: "Try again",
        attention: state.version !== null,
      };
    default: {
      const unsupported: never = state.errorStage;
      throw new Error(`Unsupported Desktop update error stage: ${unsupported}`);
    }
  }
}
