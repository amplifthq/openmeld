import type {
  DesktopUpdaterAction,
  DesktopUpdaterState,
} from "@openmeld/schemas";

export function desktopUpdaterPresentation(state: DesktopUpdaterState): {
  message: string;
  action?: DesktopUpdaterAction;
  label?: string;
} {
  switch (state.status) {
    case "available":
      return {
        message: `Version ${state.version} is available.`,
        action: "download",
        label: "Download update",
      };
    case "downloaded":
      return {
        message: state.version
          ? `Version ${state.version} is ready to install.`
          : "The update is ready to install.",
        action: "restart",
        label: "Restart to update",
      };
    case "checking":
      return { message: "Checking for updates…" };
    case "downloading":
      return {
        message: [
          state.version
            ? `Downloading version ${state.version}…`
            : "Downloading update…",
          state.percent === null ? null : `${Math.round(state.percent)}%`,
        ]
          .filter(Boolean)
          .join(" "),
      };
    case "preparing":
      return {
        message: state.version
          ? `Saving before installing version ${state.version}…`
          : "Saving before restart…",
      };
    case "installing":
      return {
        message: state.version
          ? `Restarting to install version ${state.version}…`
          : "Restarting to update…",
      };
    case "unavailable":
      return {
        message: "Updates are available in the installed production app.",
      };
    case "error": {
      if (state.errorStage === "install") {
        return {
          message:
            "The update couldn't finish. Editing is paused to protect your saved work. Choose Quit from the app menu, then reopen Desktop. The update may finish when you quit.",
        };
      }
      const action = state.errorStage ?? "check";
      const errors = {
        check: {
          message:
            "Couldn't check for updates. Check your connection and try again.",
          label: "Try again",
        },
        download: {
          message:
            "Couldn't download the update. Check your connection and try again.",
          label: "Retry download",
        },
        restart: {
          message:
            "Couldn't restart. Finish pending uploads and sends, save your changes, then try again.",
          label: "Retry restart",
        },
      };
      return { ...errors[action], action };
    }
    case "current":
      return {
        message: "OpenMeld Desktop is up to date.",
        action: "check",
        label: "Check for updates",
      };
    default:
      return {
        message: "Check for a newer version of OpenMeld Desktop.",
        action: "check",
        label: "Check for updates",
      };
  }
}
