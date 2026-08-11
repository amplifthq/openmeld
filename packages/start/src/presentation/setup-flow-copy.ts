export type SetupFlowMode = "setup" | "update_service";

export const PREPARE_SESSION_RECONNECT_GRACE_MS = 30_000;

export type SetupComputerInternalStepId =
  | "prepare_selected_agents"
  | "refresh_service"
  | "report_runtime"
  | "verify_setup";

export type SetupFlowCopy = {
  mode: SetupFlowMode;
  commandPlaceholder: string;
  connectTerminalCompleteSummary: string;
  connectTerminalDisconnectedSummary: string;
  connectTerminalPendingSummary: string;
  connectTerminalReconnectingSummary: string;
  copyCommandLabel: string;
  expiredCommandLabel: string;
  expiredCommandPlaceholder: string;
  pageDescription: string;
  pageTitle: string;
  prepareComputerBlockedSummary: string;
  prepareComputerCompleteSummary: string;
  prepareComputerDefaultActiveSummary: string;
  prepareComputerNoLocalAgentsSummary: string;
  prepareComputerPendingSummary: string;
  prepareComputerTerminalDisconnectedSummary: string;
  prepareComputerTitle: string;
  readyAccountComputerActionSummary: string;
  readyCompleteSummary: string;
  readyDefaultActionSummary: string;
  readyIncompleteSummary: string;
  readyNoSelectedLocalAgentsActionSummary: string;
  readyNoSelectedLocalAgentsSummary: string;
  readyRefreshPendingActionSummary: string;
  readyRefreshErrorSummary: string;
  readyRefreshPendingSummary: string;
  readySpaceRecoveryActionSummary: string;
  readyTitle: string;
  cliAiAgentHintTemplate: string;
  cliBootstrapRepairStatus: string;
  cliBootstrapRunStatus: string;
  cliCompletionTitle: string;
  cliProgressCheckingLocalAgents: string;
  cliProgressConnectingLocalAgents: string;
  cliProgressFinishingSetup: string;
  cliProgressStartingService: string;
  cliProgressUpdatingSkills: string;
  prepareComputerActiveSummaryByInternalStep: Record<
    SetupComputerInternalStepId,
    string
  >;
};

const SETUP_FLOW_COPY = {
  commandPlaceholder: "Building setup command...",
  connectTerminalCompleteSummary: "Terminal connected.",
  connectTerminalDisconnectedSummary:
    "Terminal disconnected. Run a fresh setup command.",
  connectTerminalPendingSummary: "Run the setup command in Terminal.",
  connectTerminalReconnectingSummary:
    "Terminal connection was interrupted. Reconnecting...",
  copyCommandLabel: "Copy setup command",
  expiredCommandLabel: "Setup command expired.",
  expiredCommandPlaceholder: "Refresh the setup command to continue.",
  mode: "setup",
  pageDescription:
    "Run one command. Setup updates automatically when Terminal connects.",
  pageTitle: "Connect this computer",
  prepareComputerActiveSummaryByInternalStep: {
    prepare_selected_agents: "Enabling local agents.",
    refresh_service: "Preparing OpenMeld Service.",
    report_runtime: "Connecting this computer.",
    verify_setup: "Checking setup.",
  },
  prepareComputerBlockedSummary: "Setup needs attention.",
  prepareComputerCompleteSummary: "Computer set up.",
  prepareComputerDefaultActiveSummary: "Setting up this computer.",
  prepareComputerNoLocalAgentsSummary: "No local agents selected.",
  prepareComputerPendingSummary: "Waiting for Terminal.",
  prepareComputerTerminalDisconnectedSummary:
    "Terminal disconnected. Run a fresh setup command.",
  prepareComputerTitle: "Connect this computer",
  readyAccountComputerActionSummary:
    "Setup complete. Back to Computers, or run setup again.",
  readyCompleteSummary: "Setup complete.",
  readyDefaultActionSummary: "Continue, or run setup again.",
  readyIncompleteSummary: "Setup not finished yet.",
  readyNoSelectedLocalAgentsActionSummary:
    "No local agents selected. Continue, or run setup again.",
  readyNoSelectedLocalAgentsSummary:
    "Setup complete. No local agents selected.",
  readyRefreshPendingActionSummary:
    "Continue after the check, or run setup again.",
  readyRefreshErrorSummary:
    "Setup complete. Wake availability could not refresh.",
  readyRefreshPendingSummary: "Checking Wake availability.",
  readySpaceRecoveryActionSummary:
    "Setup complete. Back to Space, or run setup again.",
  readyTitle: "Setup complete 🎉",
  cliAiAgentHintTemplate: "AI setup agents: run {command} for setup.complete.",
  cliBootstrapRepairStatus: "Preparing OpenMeld...",
  cliBootstrapRunStatus: "Starting OpenMeld...",
  cliCompletionTitle: "✓ OpenMeld Setup Complete 🎉",
  cliProgressCheckingLocalAgents: "Checking local agents...",
  cliProgressConnectingLocalAgents: "Enabling local agents...",
  cliProgressFinishingSetup: "Finishing setup...",
  cliProgressStartingService: "Preparing OpenMeld Service...",
  cliProgressUpdatingSkills: "Updating OpenMeld skills...",
} as const satisfies SetupFlowCopy;

const UPDATE_SERVICE_FLOW_COPY = {
  commandPlaceholder: "Building update command...",
  connectTerminalCompleteSummary: "Terminal connected.",
  connectTerminalDisconnectedSummary:
    "Terminal disconnected. Run a fresh update command.",
  connectTerminalPendingSummary: "Run the update command in Terminal.",
  connectTerminalReconnectingSummary:
    "Terminal connection was interrupted. Reconnecting...",
  copyCommandLabel: "Copy update command",
  expiredCommandLabel: "Update command expired.",
  expiredCommandPlaceholder: "Refresh the update command to continue.",
  mode: "update_service",
  pageDescription:
    "Run one command. The update continues automatically when Terminal reconnects.",
  pageTitle: "Update OpenMeld Service",
  prepareComputerActiveSummaryByInternalStep: {
    prepare_selected_agents: "Checking local agents.",
    refresh_service: "Updating OpenMeld Service.",
    report_runtime: "Connecting this computer.",
    verify_setup: "Checking update.",
  },
  prepareComputerBlockedSummary: "Update needs attention.",
  prepareComputerCompleteSummary: "OpenMeld Service updated.",
  prepareComputerDefaultActiveSummary: "Updating OpenMeld Service.",
  prepareComputerNoLocalAgentsSummary: "OpenMeld Service updated.",
  prepareComputerPendingSummary: "Waiting for Terminal.",
  prepareComputerTerminalDisconnectedSummary:
    "Terminal disconnected. Run a fresh update command.",
  prepareComputerTitle: "Update OpenMeld Service",
  readyAccountComputerActionSummary:
    "Update complete. Back to Computers, or run it again.",
  readyCompleteSummary: "Update complete.",
  readyDefaultActionSummary: "Continue, or run it again.",
  readyIncompleteSummary: "Update not finished yet.",
  readyNoSelectedLocalAgentsActionSummary:
    "Update complete. Continue, or run it again.",
  readyNoSelectedLocalAgentsSummary: "Update complete.",
  readyRefreshPendingActionSummary:
    "Continue after the check, or run it again.",
  readyRefreshErrorSummary:
    "Update complete. Wake availability could not refresh.",
  readyRefreshPendingSummary: "Checking Wake availability.",
  readySpaceRecoveryActionSummary:
    "Update complete. Back to Space, or run it again.",
  readyTitle: "Update complete",
  cliAiAgentHintTemplate: "AI setup agents: run {command} for setup.complete.",
  cliBootstrapRepairStatus: "Preparing OpenMeld...",
  cliBootstrapRunStatus: "Starting OpenMeld...",
  cliCompletionTitle: "✓ OpenMeld Service Update Complete",
  cliProgressCheckingLocalAgents: "Checking local agents...",
  cliProgressConnectingLocalAgents: "Checking local agents...",
  cliProgressFinishingSetup: "Finishing update...",
  cliProgressStartingService: "Updating OpenMeld Service...",
  cliProgressUpdatingSkills: "Updating OpenMeld skills...",
} as const satisfies SetupFlowCopy;

export function getSetupFlowCopy(mode: SetupFlowMode): SetupFlowCopy {
  return mode === "update_service" ? UPDATE_SERVICE_FLOW_COPY : SETUP_FLOW_COPY;
}

export function resolveSetupComputerActiveSummary(input: {
  copy: SetupFlowCopy;
  stepId: string;
}): string {
  if (isSetupComputerInternalStepId(input.stepId)) {
    return input.copy.prepareComputerActiveSummaryByInternalStep[input.stepId];
  }
  return input.copy.prepareComputerDefaultActiveSummary;
}

function isSetupComputerInternalStepId(
  value: string
): value is SetupComputerInternalStepId {
  return (
    value === "prepare_selected_agents" ||
    value === "refresh_service" ||
    value === "report_runtime" ||
    value === "verify_setup"
  );
}
