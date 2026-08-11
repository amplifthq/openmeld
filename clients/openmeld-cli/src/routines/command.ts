import { confirm, isCancel } from "@clack/prompts";
import { createRoutinesApi } from "@openmeld/api-client";
import {
  type CenterAgentCommandContext,
  resolveCenterAgentCommandContext,
} from "../center-agent/command-context";
import { resolveBaseUrl } from "../config/base-url";
import { emitCliJsonEnvelope } from "../runtime/cli-json-output";
import { canUseInteractivePrompts } from "../runtime/interaction";
import { createCliApiClientFoundation } from "../space/api-client-foundation";
import { emitRoutineCommandError, RoutineCommandError } from "./errors";
import {
  buildCreateRoutineBody,
  buildRoutineRunsQuery,
  buildUpdateRoutineBody,
  requireRoutineId,
  routineNotFoundError,
} from "./input";
import {
  renderRoutineConfiguration,
  renderRoutineDeleted,
  renderRoutineMutation,
  renderRoutineRuns,
  renderRoutinesList,
} from "./presentation";
import type {
  RoutinesCommandInput,
  RunRoutinesCreateInput,
  RunRoutinesDeleteInput,
  RunRoutinesRunsInput,
  RunRoutinesShowInput,
  RunRoutinesUpdateInput,
} from "./types";

export async function runRoutinesList(
  input: RoutinesCommandInput = {}
): Promise<void> {
  const context = await resolveRoutinesCommandContext(input);
  if (!context) {
    return;
  }

  try {
    const api = await createRoutinesApiClient();
    const response = await api.listRoutines();
    if (context.cliJsonOutput) {
      emitCliJsonEnvelope({
        schemaVersion: 1,
        type: "routines.list",
        ...response,
      });
      return;
    }
    renderRoutinesList({ context, response });
  } catch (error) {
    emitRoutineCommandError({ context, error, operation: "list" });
  }
}

export async function runRoutinesCreate(
  input: RunRoutinesCreateInput
): Promise<void> {
  const context = await resolveRoutinesCommandContext(input);
  if (!context) {
    return;
  }

  try {
    const api = await createRoutinesApiClient();
    const response = await api.createRoutine(buildCreateRoutineBody(input));
    if (context.cliJsonOutput) {
      emitCliJsonEnvelope({
        schemaVersion: 1,
        type: "routines.create",
        ...response,
      });
      return;
    }
    renderRoutineMutation({
      code: "routines.create",
      context,
      response,
      title: "Routine Created",
    });
  } catch (error) {
    emitRoutineCommandError({ context, error, operation: "create" });
  }
}

export async function runRoutinesShow(
  input: RunRoutinesShowInput
): Promise<void> {
  const context = await resolveRoutinesCommandContext(input);
  if (!context) {
    return;
  }

  try {
    const routineId = requireRoutineId(input.routineId);
    const api = await createRoutinesApiClient();
    const response = await api.listRoutines();
    const routine = response.routines.find((item) => item.id === routineId);
    if (!routine) {
      throw routineNotFoundError(routineId);
    }
    if (context.cliJsonOutput) {
      emitCliJsonEnvelope({
        schemaVersion: 1,
        type: "routines.show",
        routine,
      });
      return;
    }
    renderRoutineConfiguration({ context, response: { routine } });
  } catch (error) {
    emitRoutineCommandError({ context, error, operation: "show" });
  }
}

export async function runRoutinesUpdate(
  input: RunRoutinesUpdateInput
): Promise<void> {
  const context = await resolveRoutinesCommandContext(input);
  if (!context) {
    return;
  }

  try {
    const routineId = requireRoutineId(input.routineId);
    const api = await createRoutinesApiClient();
    const response = await api.updateRoutine({
      routineId,
      ...buildUpdateRoutineBody(input),
    });
    if (context.cliJsonOutput) {
      emitCliJsonEnvelope({
        schemaVersion: 1,
        type: "routines.update",
        ...response,
      });
      return;
    }
    renderRoutineMutation({
      code: "routines.update",
      context,
      response,
      title: "Routine Updated",
    });
  } catch (error) {
    emitRoutineCommandError({ context, error, operation: "update" });
  }
}

export async function runRoutinesPause(
  input: RunRoutinesShowInput
): Promise<void> {
  await runRoutineStatusMutation({
    input,
    operation: "pause",
    title: "Routine Paused",
  });
}

export async function runRoutinesResume(
  input: RunRoutinesShowInput
): Promise<void> {
  await runRoutineStatusMutation({
    input,
    operation: "resume",
    title: "Routine Resumed",
  });
}

export async function runRoutinesDelete(
  input: RunRoutinesDeleteInput
): Promise<void> {
  const context = await resolveRoutinesCommandContext(input);
  if (!context) {
    return;
  }

  try {
    const routineId = requireRoutineId(input.routineId);
    if (!(await confirmRoutineDeletion({ context, input, routineId }))) {
      return;
    }

    const api = await createRoutinesApiClient();
    const response = await api.deleteRoutine({ routineId });
    if (context.cliJsonOutput) {
      emitCliJsonEnvelope({
        schemaVersion: 1,
        type: "routines.delete",
        ...response,
      });
      return;
    }
    renderRoutineDeleted({ context, response });
  } catch (error) {
    emitRoutineCommandError({ context, error, operation: "delete" });
  }
}

export async function runRoutinesRuns(
  input: RunRoutinesRunsInput
): Promise<void> {
  const context = await resolveRoutinesCommandContext(input);
  if (!context) {
    return;
  }

  try {
    const routineId = requireRoutineId(input.routineId);
    const api = await createRoutinesApiClient();
    const response = await api.listRoutineRuns({
      routineId,
      ...buildRoutineRunsQuery(input),
    });
    if (context.cliJsonOutput) {
      emitCliJsonEnvelope({
        schemaVersion: 1,
        type: "routines.runs",
        ...response,
      });
      return;
    }
    renderRoutineRuns({
      context,
      response,
    });
  } catch (error) {
    emitRoutineCommandError({ context, error, operation: "runs" });
  }
}

async function runRoutineStatusMutation(input: {
  input: RunRoutinesShowInput;
  operation: "pause" | "resume";
  title: string;
}): Promise<void> {
  const context = await resolveRoutinesCommandContext(input.input);
  if (!context) {
    return;
  }

  try {
    const routineId = requireRoutineId(input.input.routineId);
    const api = await createRoutinesApiClient();
    const response =
      input.operation === "pause"
        ? await api.pauseRoutine({ routineId })
        : await api.resumeRoutine({ routineId });
    if (context.cliJsonOutput) {
      emitCliJsonEnvelope({
        schemaVersion: 1,
        type:
          input.operation === "pause" ? "routines.pause" : "routines.resume",
        ...response,
      });
      return;
    }
    renderRoutineMutation({
      code: input.operation === "pause" ? "routines.pause" : "routines.resume",
      context,
      response,
      title: input.title,
    });
  } catch (error) {
    emitRoutineCommandError({
      context,
      error,
      operation: input.operation,
    });
  }
}

async function confirmRoutineDeletion(input: {
  context: CenterAgentCommandContext;
  input: RunRoutinesDeleteInput;
  routineId: string;
}): Promise<boolean> {
  if (input.input.yes) {
    return true;
  }
  if (!canUseInteractivePrompts(input.context.runtime)) {
    throw new RoutineCommandError({
      code: "routine.delete.confirmation_required",
      message: "Routine deletion requires explicit confirmation.",
      nextStep: `Run \`openmeld routines delete ${input.routineId} --yes\`.`,
      title: "Deletion Confirmation Required",
    });
  }
  const confirmed = await confirm({
    initialValue: false,
    message: `Permanently delete Routine ${input.routineId}?`,
  });
  if (isCancel(confirmed) || !confirmed) {
    input.context.presenter.line({
      code: "routines.delete.cancelled",
      text: "Deletion canceled. The Routine was not changed.",
    });
    return false;
  }
  return true;
}

async function resolveRoutinesCommandContext(
  input: RoutinesCommandInput
): Promise<CenterAgentCommandContext | null> {
  return await resolveCenterAgentCommandContext({
    cliJsonOutput: input.json === true,
    view: input.view,
  });
}

async function createRoutinesApiClient() {
  return createRoutinesApi(
    createCliApiClientFoundation(await resolveBaseUrl())
  );
}
