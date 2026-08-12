import {
  canMaterializeCenterAgentOrganizationDocuments,
  canMaterializeCenterAgentOrganizationSkills,
  resolveCenterAgentContextScopePlan,
} from "@openmeld/agent-runtime";
import type { RemoteAgentTurnEnvelope } from "@openmeld/schemas/types";
import type { RemoteAgentWorkSurfaceBinding } from "../agent-core/work-surface-routing";

export type CenterAgentMaterializationStage =
  | "documents"
  | "model"
  | "progress"
  | "sandbox"
  | "skills"
  | "tools";

export type CenterAgentMaterializationStageObservation = {
  durationMs?: number;
  errorName?: string;
  stage: CenterAgentMaterializationStage;
  status: "failed" | "started" | "succeeded";
  submissionId: string | null;
};

type CenterAgentRuntimeMaterializationInput<
  TModel,
  TDocuments,
  TSkills,
  TSandbox,
  TTools,
> = {
  createSandbox: () => Promise<TSandbox>;
  createTools: (sandbox: TSandbox) => Promise<TTools>;
  markProgress: () => Promise<unknown>;
  materializeSkills: () => Promise<TSkills>;
  readDocuments: () => Promise<TDocuments>;
  registerModel: () => Promise<TModel>;
  reportStage?: (
    observation: CenterAgentMaterializationStageObservation
  ) => void;
  submissionId: string | null;
};

type CenterAgentRuntimeMaterialization<
  TModel,
  TDocuments,
  TSkills,
  TSandbox,
  TTools,
> = {
  documents: TDocuments;
  model: TModel;
  sandbox: TSandbox;
  skills: TSkills;
  tools: TTools;
};

export type CenterAgentRuntimeContextPlan = {
  materializeOrganizationDocuments: boolean;
  materializeOrganizationSkills: boolean;
};

export type CenterAgentRuntimeMaterializationPlan =
  CenterAgentRuntimeContextPlan & {
    allowedToolNames: readonly string[] | null;
    materializeComputer: boolean;
  };

export function resolveCenterAgentRuntimeContextPlan(
  turnEnvelope: RemoteAgentTurnEnvelope
): CenterAgentRuntimeContextPlan {
  const contextScopePlan = resolveCenterAgentContextScopePlan(turnEnvelope);
  return {
    materializeOrganizationDocuments:
      canMaterializeCenterAgentOrganizationDocuments(contextScopePlan),
    materializeOrganizationSkills:
      canMaterializeCenterAgentOrganizationSkills(contextScopePlan),
  };
}

export function resolveCenterAgentRuntimeMaterializationPlan(input: {
  turnEnvelope: RemoteAgentTurnEnvelope;
  workSurfaceBinding?: RemoteAgentWorkSurfaceBinding | null;
}): CenterAgentRuntimeMaterializationPlan {
  if (input.workSurfaceBinding) {
    return {
      allowedToolNames: [
        input.workSurfaceBinding.surface === "new_task"
          ? "openmeld_create_task"
          : "openmeld_create_space",
      ],
      materializeComputer: false,
      materializeOrganizationDocuments: false,
      materializeOrganizationSkills: false,
    };
  }
  return {
    ...resolveCenterAgentRuntimeContextPlan(input.turnEnvelope),
    allowedToolNames: null,
    materializeComputer: true,
  };
}

export async function materializeCenterAgentRuntime<
  TModel,
  TDocuments,
  TSkills,
  TSandbox,
  TTools,
>(
  input: CenterAgentRuntimeMaterializationInput<
    TModel,
    TDocuments,
    TSkills,
    TSandbox,
    TTools
  >
): Promise<
  CenterAgentRuntimeMaterialization<
    TModel,
    TDocuments,
    TSkills,
    TSandbox,
    TTools
  >
> {
  await measureCenterAgentMaterializationStage({
    execute: input.markProgress,
    reportStage: input.reportStage,
    stage: "progress",
    submissionId: input.submissionId,
  });
  const model = await measureCenterAgentMaterializationStage({
    execute: input.registerModel,
    reportStage: input.reportStage,
    stage: "model",
    submissionId: input.submissionId,
  });
  const documents = await measureCenterAgentMaterializationStage({
    execute: input.readDocuments,
    reportStage: input.reportStage,
    stage: "documents",
    submissionId: input.submissionId,
  });
  const skills = await measureCenterAgentMaterializationStage({
    execute: input.materializeSkills,
    reportStage: input.reportStage,
    stage: "skills",
    submissionId: input.submissionId,
  });
  const sandbox = await measureCenterAgentMaterializationStage({
    execute: input.createSandbox,
    reportStage: input.reportStage,
    stage: "sandbox",
    submissionId: input.submissionId,
  });
  const tools = await measureCenterAgentMaterializationStage({
    execute: async () => await input.createTools(sandbox),
    reportStage: input.reportStage,
    stage: "tools",
    submissionId: input.submissionId,
  });
  return { documents, model, sandbox, skills, tools };
}

async function measureCenterAgentMaterializationStage<T>(input: {
  execute: () => Promise<T>;
  reportStage?: (
    observation: CenterAgentMaterializationStageObservation
  ) => void;
  stage: CenterAgentMaterializationStage;
  submissionId: string | null;
}): Promise<T> {
  const startedAtMs = Date.now();
  reportCenterAgentMaterializationStage(input.reportStage, {
    stage: input.stage,
    status: "started",
    submissionId: input.submissionId,
  });
  console.info("[remote_agent.materialization_stage_started]", {
    stage: input.stage,
    submissionId: input.submissionId,
  });
  try {
    const result = await input.execute();
    const durationMs = Date.now() - startedAtMs;
    reportCenterAgentMaterializationStage(input.reportStage, {
      durationMs,
      stage: input.stage,
      status: "succeeded",
      submissionId: input.submissionId,
    });
    console.info("[remote_agent.materialization_stage_completed]", {
      durationMs,
      stage: input.stage,
      submissionId: input.submissionId,
    });
    return result;
  } catch (error) {
    const durationMs = Date.now() - startedAtMs;
    const errorName = error instanceof Error ? error.name : "UnknownError";
    reportCenterAgentMaterializationStage(input.reportStage, {
      durationMs,
      errorName,
      stage: input.stage,
      status: "failed",
      submissionId: input.submissionId,
    });
    console.error("[remote_agent.materialization_stage_failed]", {
      durationMs,
      errorName,
      stage: input.stage,
      submissionId: input.submissionId,
    });
    throw error;
  }
}

function reportCenterAgentMaterializationStage(
  reportStage:
    | ((observation: CenterAgentMaterializationStageObservation) => void)
    | undefined,
  observation: CenterAgentMaterializationStageObservation
): void {
  try {
    reportStage?.(observation);
  } catch (error) {
    console.error("[remote_agent.materialization_stage_reporting_failed]", {
      errorName: error instanceof Error ? error.name : "UnknownError",
      stage: observation.stage,
      status: observation.status,
      submissionId: observation.submissionId,
    });
  }
}
