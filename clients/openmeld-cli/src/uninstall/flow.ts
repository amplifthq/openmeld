import { listScopeLanes } from "./lane-scope";
import type {
  ResolvedUninstallRequest,
  UninstallBlockedStep,
  UninstallCancelledStep,
  UninstallFlowDependencies,
  UninstallFlowResult,
  UninstallLaneResult,
  UninstallScope,
  UninstallWarning,
} from "./types";

export async function runUninstallFlow(
  input: {
    scope: UninstallScope;
    interactive: boolean;
    yes: boolean;
    force: boolean;
  },
  deps: UninstallFlowDependencies
): Promise<UninstallFlowResult> {
  const request = await resolveRequest(input, deps);
  if (isFlowResult(request)) {
    return request;
  }

  const confirmation = await confirmRequest(request, deps);
  if (confirmation) {
    return confirmation;
  }

  const cleanup = await runOptionalCleanup(request, deps);
  if (cleanup) {
    return cleanup;
  }

  const laneResults = await removeScopeLanes(request, deps);
  if (isFlowResult(laneResults)) {
    return laneResults;
  }

  const finalCliRemoval = await runFlowStep({
    step: "final_cli_removal",
    warnings: request.warnings,
    run: async () => await deps.resolveFinalCliRemoval(request),
  });
  if (isFlowResult(finalCliRemoval)) {
    return finalCliRemoval;
  }

  return {
    status: "completed",
    request,
    laneResults,
    finalCliRemoval,
  };
}

async function resolveRequest(
  input: {
    scope: UninstallScope;
    interactive: boolean;
    yes: boolean;
    force: boolean;
  },
  deps: UninstallFlowDependencies
): Promise<ResolvedUninstallRequest | UninstallFlowResult> {
  const skillsDecision = await deps.resolveSkillsAction({
    scope: input.scope,
    interactive: input.interactive,
  });
  if (skillsDecision.status === "cancelled") {
    return cancelled("skills");
  }

  const authTokenDecision = await deps.resolveAuthTokenAction({
    scope: input.scope,
    interactive: input.interactive,
  });
  if (authTokenDecision.status === "cancelled") {
    return cancelled("auth_tokens");
  }

  const warnings = await resolveFlowWarnings({
    deps,
    scope: input.scope,
    authTokenAction: authTokenDecision.value,
  });
  if (warnings.status !== "continue") {
    return warnings.result;
  }

  return {
    scope: input.scope,
    skillsAction: skillsDecision.value,
    authTokenAction: authTokenDecision.value,
    interactive: input.interactive,
    yes: input.yes,
    force: input.force,
    warnings: warnings.warnings,
  };
}

async function confirmRequest(
  request: ResolvedUninstallRequest,
  deps: UninstallFlowDependencies
): Promise<UninstallFlowResult | null> {
  if (request.scope.kind === "current-lane" && deps.confirmCurrentLane) {
    const confirmation = await deps.confirmCurrentLane({
      scope: request.scope,
      interactive: request.interactive,
      yes: request.yes,
    });
    if (confirmation.status === "cancelled") {
      return cancelled("current_lane_confirmation");
    }
  }

  if (request.scope.kind === "all-lanes" && deps.confirmAllLanes) {
    const confirmation = await deps.confirmAllLanes({
      scope: request.scope,
      interactive: request.interactive,
      yes: request.yes,
      force: request.force,
    });
    if (confirmation.status === "cancelled") {
      return cancelled("all_lanes_confirmation");
    }
  }

  return null;
}

async function runOptionalCleanup(
  request: ResolvedUninstallRequest,
  deps: UninstallFlowDependencies
): Promise<UninstallFlowResult | null> {
  if (request.skillsAction === "remove") {
    const result = await runFlowStep({
      step: "skills",
      warnings: request.warnings,
      run: async () => {
        await deps.removeSkills(request);
      },
    });
    if (isFlowResult(result)) {
      return result;
    }
  }

  if (request.authTokenAction === "remove") {
    const result = await runFlowStep({
      step: "auth_tokens",
      warnings: request.warnings,
      run: async () => {
        await deps.clearAuthTokens(request);
      },
    });
    if (isFlowResult(result)) {
      return result;
    }
  }

  return null;
}

async function removeScopeLanes(
  request: ResolvedUninstallRequest,
  deps: UninstallFlowDependencies
): Promise<UninstallLaneResult[] | UninstallFlowResult> {
  const laneResults: UninstallLaneResult[] = [];
  for (const lane of listScopeLanes(request.scope)) {
    const serviceResult = await runFlowStep({
      step: "service",
      warnings: request.warnings,
      run: async () =>
        await deps.teardownService({
          lane,
          request,
        }),
    });
    if (isFlowResult(serviceResult)) {
      return serviceResult;
    }

    const homeResult = await runFlowStep({
      step: "home",
      warnings: request.warnings,
      run: async () =>
        await deps.removeHome({
          lane,
          request,
        }),
    });
    if (isFlowResult(homeResult)) {
      return homeResult;
    }

    laneResults.push({
      lane,
      serviceRemoved: serviceResult.removed,
      homeRemoved: homeResult.removed,
      homePath: homeResult.homePath,
    });
  }

  return laneResults;
}

async function resolveFlowWarnings(input: {
  deps: UninstallFlowDependencies;
  scope: UninstallScope;
  authTokenAction: ResolvedUninstallRequest["authTokenAction"];
}): Promise<
  | {
      status: "continue";
      warnings: readonly UninstallWarning[];
    }
  | {
      status: "blocked";
      result: UninstallFlowResult;
    }
> {
  if (!input.deps.resolveWarnings) {
    return {
      status: "continue",
      warnings: [],
    };
  }

  try {
    const warnings = await input.deps.resolveWarnings({
      scope: input.scope,
      authTokenAction: input.authTokenAction,
    });
    return {
      status: "continue",
      warnings,
    };
  } catch (error) {
    return {
      status: "blocked",
      result: blocked("auth_tokens", error, []),
    };
  }
}

async function runFlowStep<T>(input: {
  step: UninstallBlockedStep;
  warnings: readonly UninstallWarning[];
  run: () => Promise<T>;
}): Promise<T | UninstallFlowResult> {
  try {
    return await input.run();
  } catch (error) {
    return blocked(input.step, error, input.warnings);
  }
}

function cancelled(step: UninstallCancelledStep): UninstallFlowResult {
  return {
    status: "cancelled",
    step,
  };
}

function blocked(
  step: UninstallBlockedStep,
  error: unknown,
  warnings: readonly UninstallWarning[]
): UninstallFlowResult {
  return {
    status: "blocked",
    step,
    reason: toErrorMessage(error),
    warnings,
  };
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message.trim();
  }
  return (
    String(error ?? "unknown uninstall failure").trim() ||
    "unknown uninstall failure"
  );
}

function isFlowResult(value: unknown): value is UninstallFlowResult {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    "status" in (value as Record<string, unknown>)
  );
}
