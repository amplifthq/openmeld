import type { SpacePanelKind } from "./panel/space-panel-definition";

export const JOIN_MODE_SUMMARY_HINT = "type /members to check";
export const READONLY_MODE_SUMMARY_HINT =
  "press m for members · l for logs · s for space";

const WATCH_MODE_EXIT_HINT =
  "Watch-only mode · m members · l logs · s space · Ctrl+D/Ctrl+C/q quit.";
const HISTORY_VIEW_EXIT_HINT =
  "History view · m members · l logs · s space · Ctrl+D/Ctrl+C/q quit.";

export function resolveReadonlyOverlayShortcut(
  data: string
): SpacePanelKind | null {
  if (data === "/" || data === "?") {
    return "help";
  }
  if (data === "s") {
    return "space";
  }
  if (data === "m") {
    return "members";
  }
  if (data === "l") {
    return "logs";
  }
  return null;
}

export function resolveSessionHeaderSummaryHint(
  connectionMode: "join" | "watch" | "history"
): string {
  switch (connectionMode) {
    case "join":
      return JOIN_MODE_SUMMARY_HINT;
    case "watch":
    case "history":
      return READONLY_MODE_SUMMARY_HINT;
    default:
      return JOIN_MODE_SUMMARY_HINT;
  }
}

export function resolveReadonlySessionFooterText(
  connectionMode: "watch" | "history"
): string {
  switch (connectionMode) {
    case "watch":
      return WATCH_MODE_EXIT_HINT;
    case "history":
      return HISTORY_VIEW_EXIT_HINT;
    default:
      return WATCH_MODE_EXIT_HINT;
  }
}
