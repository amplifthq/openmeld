import type { CommandEntryName } from "../command-entry-checks/types";

export type CommandContractRenderContext = {
  agentExampleArg?: string;
  includeViewFlag?: boolean;
  profileId?: string | null;
};

export type CommandPatternContract<
  TContext extends CommandContractRenderContext = CommandContractRenderContext,
> = {
  buildCommands: (context: TContext) => string[];
  buildHints?: (context: TContext) => string[];
  buildOptionalArguments?: (context: TContext) => string[];
  buildRequiredArguments?: (context: TContext) => string[];
};

type ContractFieldResolver<
  TContext extends CommandContractRenderContext,
  TValue,
> = TValue | ((context: TContext) => TValue);

export type CommandGuideScenarioContract<
  TContext extends CommandContractRenderContext = CommandContractRenderContext,
> = {
  code: string;
  hints?: ContractFieldResolver<TContext, string[]>;
  humanSteps: ContractFieldResolver<TContext, string[]>;
  notes?: ContractFieldResolver<TContext, string[]>;
  optionalArguments?: ContractFieldResolver<TContext, string[]>;
  pattern?: CommandPatternContract<TContext>;
  requiredArguments?: ContractFieldResolver<TContext, string[]>;
  summary: ContractFieldResolver<TContext, string>;
  commands?: ContractFieldResolver<TContext, string[]>;
};

export type AgentOverviewHumanActionRequired =
  | boolean
  | {
      possible: boolean;
      steps: string[];
    };

export type CommandAgentOverviewContract<
  TContext extends CommandContractRenderContext = CommandContractRenderContext,
> = {
  commands?: ContractFieldResolver<TContext, string[]>;
  extraPayload?: ContractFieldResolver<TContext, Record<string, unknown>>;
  humanActionRequired: AgentOverviewHumanActionRequired;
  notes: ContractFieldResolver<TContext, string[]>;
  optionalArguments?: ContractFieldResolver<TContext, string[]>;
  pattern?: CommandPatternContract<TContext>;
  requiredArguments?: ContractFieldResolver<TContext, string[]>;
  stages: ContractFieldResolver<TContext, string[]>;
  summary: ContractFieldResolver<TContext, string>;
};

export type CommandEntryContract<
  TContext extends CommandContractRenderContext = CommandContractRenderContext,
> = {
  agentOverview?: CommandAgentOverviewContract<TContext>;
  buildHints?: (context: TContext) => string[];
  entryName: CommandEntryName;
  guideScenarios?: Record<string, CommandGuideScenarioContract<TContext>>;
};

export type CommandContractFieldResolver<
  TContext extends CommandContractRenderContext,
  TValue,
> = ContractFieldResolver<TContext, TValue>;
