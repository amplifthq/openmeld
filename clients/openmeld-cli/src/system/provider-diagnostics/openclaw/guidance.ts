import type { OpenClawLocalDiagnostics } from "../../../provider-hosts/openclaw/diagnostics";

export type OpenClawDiagnosticsGuidance = {
  nextCommands: string[];
  summary: string;
};

export function resolveOpenClawDiagnosticsGuidance(input: {
  diagnostics: OpenClawLocalDiagnostics;
  profileId: string;
}): OpenClawDiagnosticsGuidance {
  const diagnostics = input.diagnostics;
  const setupCommand = `openmeld setup --profile ${input.profileId}`;
  if (diagnostics.bootstrapStatus !== "healthy") {
    const bootstrapCommandUnavailableSummary =
      resolveBootstrapCommandUnavailableSummary(diagnostics.message);
    if (bootstrapCommandUnavailableSummary) {
      return {
        summary: bootstrapCommandUnavailableSummary,
        nextCommands: [setupCommand, "openclaw agents list"],
      };
    }
    switch (diagnostics.bootstrapStatus) {
      case "binding_conflict":
        return {
          summary:
            "OpenMeld found a local OpenClaw binding conflict for this profile.",
          nextCommands: [setupCommand, "openclaw agents list"],
        };
      case "workspace_mismatch":
        return {
          summary:
            "OpenMeld found a local OpenClaw workspace mismatch for this profile.",
          nextCommands: [setupCommand, "openclaw agents list"],
        };
      case "workspace_ambiguous":
        return {
          summary:
            "OpenMeld found multiple OpenClaw agents claiming the same OpenMeld-managed workspace for this profile.",
          nextCommands: [setupCommand, "openclaw agents list"],
        };
      case "invalid":
        return {
          summary:
            "OpenMeld found an invalid local OpenClaw bootstrap state for this profile.",
          nextCommands: [setupCommand, "openclaw agents list"],
        };
      default:
        return {
          summary:
            "OpenMeld could not find a healthy local OpenClaw bootstrap for this profile yet.",
          nextCommands: [setupCommand, "openclaw agents list"],
        };
    }
  }

  if (diagnostics.gatewayHealth !== "healthy") {
    return {
      summary: "The local OpenClaw Gateway is not healthy on this device.",
      nextCommands: [setupCommand, "openclaw health --json"],
    };
  }

  switch (diagnostics.gatewayVisibility) {
    case "restart_failed":
      return {
        summary:
          "OpenMeld could not restart the local OpenClaw Gateway while checking this profile.",
        nextCommands: [setupCommand, "openclaw health --json"],
      };
    case "not_visible":
      return {
        summary:
          "OpenMeld can reach the local OpenClaw Gateway, but this OpenClaw agent is still not visible there.",
        nextCommands: [setupCommand, "openclaw agents list"],
      };
    case "not_checked":
      return {
        summary:
          "OpenMeld could not verify local OpenClaw Gateway visibility for this profile yet.",
        nextCommands: [setupCommand, "openclaw health --json"],
      };
    case "restarted_then_visible":
    case "visible":
      break;
    default:
      return {
        summary:
          "OpenMeld could not verify local OpenClaw Gateway visibility for this profile yet.",
        nextCommands: [setupCommand, "openclaw health --json"],
      };
  }

  if (diagnostics.authStatus === "source_missing") {
    return {
      summary:
        "OpenMeld could not find a default OpenClaw auth source on this device.",
      nextCommands: [setupCommand, "openclaw agents list"],
    };
  }

  return {
    summary: "This OpenClaw profile can handle OpenMeld local replies.",
    nextCommands: [
      `openmeld space send YOUR_SPACE_ID "@YOUR_WAKE_HANDLE hello"`,
    ],
  };
}

function resolveBootstrapCommandUnavailableSummary(
  message: string | null | undefined
): string | null {
  const normalized = String(message ?? "")
    .trim()
    .toLowerCase();
  if (!normalized.includes("openclaw is not installed or not on path")) {
    return null;
  }
  return "OpenMeld could not start OpenClaw on this device. Install OpenClaw or fix its PATH for background services, then try again.";
}
