import { formatAgentOverviewPayload } from "../runtime/agent-overview-payload";
import { DualViewGuideError } from "../runtime/dual-view-guide-error";
import type {
  CommandAgentOverviewContract,
  CommandContractFieldResolver,
  CommandContractRenderContext,
  CommandGuideScenarioContract,
} from "./types";

type CommandContractError = Error & {
  code: string;
};

export function createCommandContractError(
  code: string,
  message: string
): CommandContractError {
  const error = new Error(message) as CommandContractError;
  error.code = code;
  return error;
}

export function buildAgentOverviewFromContract<
  TContext extends CommandContractRenderContext,
>(input: {
  context: TContext;
  overview: CommandAgentOverviewContract<TContext>;
}): {
  commands: string[];
  humanActionRequired: CommandAgentOverviewContract<TContext>["humanActionRequired"];
  notes: string[];
  optionalArguments: string[];
  requiredArguments: string[];
  stages: string[];
  summary: string;
} & Record<string, unknown> {
  const pattern = input.overview.pattern;
  return formatAgentOverviewPayload({
    ...(resolveContractField(input.overview.extraPayload, input.context) ?? {}),
    commands:
      resolveContractField(input.overview.commands, input.context) ??
      pattern?.buildCommands(input.context) ??
      [],
    humanActionRequired: input.overview.humanActionRequired,
    notes: resolveContractField(input.overview.notes, input.context) ?? [],
    optionalArguments:
      resolveContractField(input.overview.optionalArguments, input.context) ??
      pattern?.buildOptionalArguments?.(input.context) ??
      [],
    requiredArguments:
      resolveContractField(input.overview.requiredArguments, input.context) ??
      pattern?.buildRequiredArguments?.(input.context) ??
      [],
    stages: resolveContractField(input.overview.stages, input.context) ?? [],
    summary: resolveContractField(input.overview.summary, input.context) ?? "",
  });
}

export function createGuideErrorFromContract<
  TContext extends CommandContractRenderContext,
>(input: {
  context: TContext;
  guideScenario: CommandGuideScenarioContract<TContext>;
}): DualViewGuideError {
  const pattern = input.guideScenario.pattern;
  return new DualViewGuideError({
    code: input.guideScenario.code,
    guide: {
      summary:
        resolveContractField(input.guideScenario.summary, input.context) ?? "",
      humanSteps:
        resolveContractField(input.guideScenario.humanSteps, input.context) ??
        [],
      agentRequiredArgs:
        resolveContractField(
          input.guideScenario.requiredArguments,
          input.context
        ) ??
        pattern?.buildRequiredArguments?.(input.context) ??
        [],
      agentOptionalArgs:
        resolveContractField(
          input.guideScenario.optionalArguments,
          input.context
        ) ??
        pattern?.buildOptionalArguments?.(input.context) ??
        [],
      agentCommands:
        resolveContractField(input.guideScenario.commands, input.context) ??
        pattern?.buildCommands(input.context) ??
        [],
      notes:
        resolveContractField(input.guideScenario.notes, input.context) ?? [],
    },
    hints:
      resolveContractField(input.guideScenario.hints, input.context) ??
      pattern?.buildHints?.(input.context) ??
      pattern?.buildCommands(input.context) ??
      [],
  });
}

function resolveContractField<
  TContext extends CommandContractRenderContext,
  TValue,
>(
  value: CommandContractFieldResolver<TContext, TValue> | undefined,
  context: TContext
): TValue | undefined {
  if (typeof value === "function") {
    return (value as (context: TContext) => TValue)(context);
  }
  return value;
}
