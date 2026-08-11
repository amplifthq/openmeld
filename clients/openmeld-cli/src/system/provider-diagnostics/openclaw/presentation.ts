import type {
  OpenClawDiagnosticsMode,
  OpenClawLocalDiagnostics,
} from "../../../provider-hosts/openclaw/diagnostics";

export function formatOpenClawBootstrapDisplay(input: {
  diagnostics: OpenClawLocalDiagnostics;
  mode: OpenClawDiagnosticsMode;
}): string {
  if (
    input.mode === "repair" &&
    input.diagnostics.bootstrapStatus === "healthy" &&
    input.diagnostics.bootstrapResolution
  ) {
    return input.diagnostics.bootstrapResolution;
  }
  switch (input.diagnostics.bootstrapStatus) {
    case "binding_conflict":
      return "binding conflict";
    case "workspace_ambiguous":
      return "workspace ambiguous";
    case "workspace_mismatch":
      return "workspace mismatch";
    default:
      return input.diagnostics.bootstrapStatus;
  }
}

export function formatOpenClawAuthDisplay(input: {
  diagnostics: OpenClawLocalDiagnostics;
  mode: OpenClawDiagnosticsMode;
}): string {
  if (input.diagnostics.bootstrapStatus !== "healthy") {
    return "not available until bootstrap is healthy";
  }
  if (input.mode === "inspect" && input.diagnostics.authStatus === "copied") {
    return "repairable from default agent";
  }
  switch (input.diagnostics.authStatus) {
    case "copied":
      return "copied from default agent";
    case "present":
      return "present";
    case "source_missing":
      return "source missing";
    default:
      return String(input.diagnostics.authStatus);
  }
}

export function formatOpenClawGatewayHealthDisplay(
  diagnostics: OpenClawLocalDiagnostics
): string {
  const gatewayHealth = diagnostics.gatewayHealth;
  if (gatewayHealth == null) {
    return "unknown";
  }
  switch (gatewayHealth) {
    case "healthy":
      return "healthy";
    case "unhealthy":
      return "unhealthy";
    default:
      return gatewayHealth;
  }
}

export function formatOpenClawGatewayVisibilityDisplay(
  diagnostics: OpenClawLocalDiagnostics
): string {
  switch (diagnostics.gatewayVisibility) {
    case "restarted_then_visible":
      return "restarted then visible";
    case "restart_failed":
      return "restart failed";
    case "not_checked":
      return "not checked";
    case "not_visible":
      return "not visible";
    case "visible":
      return "visible";
    default:
      return String(diagnostics.gatewayVisibility);
  }
}
