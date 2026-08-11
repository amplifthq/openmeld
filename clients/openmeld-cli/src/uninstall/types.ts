import type {
  OpenMeldEnvPreset,
  OpenMeldPathResolutionInput,
} from "../config/paths";

export type UninstallAction = "keep" | "remove";

export type UninstallScope =
  | {
      kind: "current-lane";
      lane: OpenMeldEnvPreset;
    }
  | {
      kind: "all-lanes";
      lanes: readonly OpenMeldEnvPreset[];
    };

export type UninstallScopeInput = OpenMeldPathResolutionInput & {
  allLanes?: boolean;
};

export type UninstallWarning = {
  code: "shared_auth_tokens";
  message: string;
  affectedLanes: readonly OpenMeldEnvPreset[];
};

export type ProductionCliInstallSource = "npm-global" | "unknown";

export type ManualCliRemoval =
  | {
      kind: "command";
      command: string;
      reason: string;
    }
  | {
      kind: "manual";
      message: string;
      reason: string;
      suggestedCommand?: string;
    };

export type ResolvedUninstallRequest = {
  scope: UninstallScope;
  skillsAction: UninstallAction;
  authTokenAction: UninstallAction;
  interactive: boolean;
  yes: boolean;
  force: boolean;
  warnings: readonly UninstallWarning[];
};

export type UninstallLaneResult = {
  lane: OpenMeldEnvPreset;
  serviceRemoved: boolean;
  homeRemoved: boolean;
  homePath: string | null;
};

export type UninstallCancelledStep =
  | "skills"
  | "auth_tokens"
  | "current_lane_confirmation"
  | "all_lanes_confirmation";

export type UninstallBlockedStep =
  | "skills"
  | "auth_tokens"
  | "service"
  | "home"
  | "final_cli_removal";

export type UninstallFlowResult =
  | {
      status: "completed";
      request: ResolvedUninstallRequest;
      laneResults: UninstallLaneResult[];
      finalCliRemoval: ManualCliRemoval;
    }
  | {
      status: "cancelled";
      step: UninstallCancelledStep;
    }
  | {
      status: "blocked";
      step: UninstallBlockedStep;
      reason: string;
      warnings: readonly UninstallWarning[];
    };

export type UninstallChoice<T> =
  | {
      status: "resolved";
      value: T;
    }
  | {
      status: "cancelled";
    };

export type UninstallFlowDependencies = {
  resolveSkillsAction: (input: {
    scope: UninstallScope;
    interactive: boolean;
  }) => Promise<UninstallChoice<UninstallAction>>;
  resolveAuthTokenAction: (input: {
    scope: UninstallScope;
    interactive: boolean;
  }) => Promise<UninstallChoice<UninstallAction>>;
  confirmAllLanes?: (input: {
    scope: UninstallScope;
    interactive: boolean;
    yes: boolean;
    force: boolean;
  }) => Promise<UninstallChoice<true>>;
  confirmCurrentLane?: (input: {
    scope: UninstallScope;
    interactive: boolean;
    yes: boolean;
  }) => Promise<UninstallChoice<true>>;
  resolveWarnings?: (input: {
    scope: UninstallScope;
    authTokenAction: UninstallAction;
  }) => Promise<readonly UninstallWarning[]>;
  removeSkills: (input: ResolvedUninstallRequest) => Promise<void>;
  clearAuthTokens: (input: ResolvedUninstallRequest) => Promise<void>;
  teardownService: (input: {
    lane: OpenMeldEnvPreset;
    request: ResolvedUninstallRequest;
  }) => Promise<{ removed: boolean }>;
  removeHome: (input: {
    lane: OpenMeldEnvPreset;
    request: ResolvedUninstallRequest;
  }) => Promise<{ removed: boolean; homePath: string | null }>;
  resolveFinalCliRemoval: (
    input: ResolvedUninstallRequest
  ) => Promise<ManualCliRemoval>;
};
