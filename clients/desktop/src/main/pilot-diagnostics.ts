import type { WebContents } from "electron";

// Only fixed classifications enter terminal logs. Full messages and request
// details remain in local DevTools, where the developer can inspect them.
function consoleCategory(message: string): string {
  if (message.includes("Content Security Policy")) {
    return "csp-block";
  }
  if (message.includes("ReferenceError")) {
    return "reference-error";
  }
  if (message.includes("TypeError")) {
    return "type-error";
  }
  if (message.includes("SyntaxError")) {
    return "syntax-error";
  }
  if (message.includes("BetterAuthError")) {
    return "auth-client-error";
  }
  return "console-message";
}

export function observePilotWindow(contents: WebContents): void {
  const report = (event: string, details = {}) => {
    console.info("[desktop-pilot]", event, JSON.stringify(details));
  };
  contents.on("did-start-loading", () => report("load-start"));
  contents.on("dom-ready", () => report("dom-ready"));
  contents.on("did-finish-load", () => report("load-finished"));
  contents.on("did-stop-loading", () => report("load-stopped"));
  contents.on(
    "did-fail-load",
    (_event, code, _description, _url, mainFrame) => {
      report("load-failed", { code, mainFrame });
    }
  );
  contents.on("preload-error", () => report("preload-failed"));
  contents.on("render-process-gone", (_event, details) => {
    report("renderer-gone", {
      reason: details.reason,
      exitCode: details.exitCode,
    });
  });
  contents.on("unresponsive", () => report("renderer-unresponsive"));
  contents.on("console-message", (details) => {
    report(consoleCategory(details.message), {
      level: details.level,
      line: details.lineNumber,
    });
  });
  contents.openDevTools({ mode: "detach", activate: true });
  report("diagnostics-enabled");
}
