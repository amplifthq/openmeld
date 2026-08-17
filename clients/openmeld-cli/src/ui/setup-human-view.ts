import type { Presenter } from "../runtime/presenter";
import type { RuntimeContext } from "../runtime/types";
import { renderOpenMeldBrandBlockLines } from "./brand";
import { type InfoCardRow, renderInfoCard } from "./info-card";
import {
  createSetupProgressReporter,
  type SetupProgressStepHandle,
} from "./setup-progress";

type SetupHumanView = "human" | "agent";

export async function runWithSetupProgress<T>(input: {
  code: string;
  completionMessage: string;
  message: string;
  presenter: Presenter;
  run: (progress: SetupProgressStepHandle) => Promise<T>;
  runtime: RuntimeContext;
}): Promise<T> {
  const progress = createSetupProgressReporter({
    presenter: input.presenter,
    runtime: input.runtime,
  }).startStep({
    code: input.code,
    text: input.message,
  });
  try {
    const result = await input.run(progress);
    progress.complete(input.completionMessage);
    return result;
  } catch (error) {
    progress.fail();
    throw error;
  }
}

export function emitSetupHumanHeader(input: {
  presenter: Presenter;
  view: SetupHumanView;
}): void {
  if (input.view !== "human") {
    return;
  }

  input.presenter.line({
    code: "setup.header.spacing.start",
    text: "",
  });
  for (const line of renderOpenMeldBrandBlockLines()) {
    input.presenter.line({
      code: "setup.header.brand",
      text: line,
    });
  }
  input.presenter.line({
    code: "setup.header.spacing.end",
    text: "",
  });
}

export function renderSetupStepCard(input: {
  codePrefix: string;
  presenter: Presenter;
  rows: InfoCardRow[];
  title: string;
  view: SetupHumanView;
}): void {
  if (input.view !== "human") {
    return;
  }

  renderInfoCard({
    presenter: input.presenter,
    title: input.title,
    codePrefix: input.codePrefix,
    rows: input.rows,
    sanitize: true,
    minContentWidth: 52,
  });
}

export function renderSetupAgentHandoffHint(input: {
  text: string;
  presenter: Presenter;
  view: SetupHumanView;
}): void {
  if (input.view !== "human") {
    return;
  }

  input.presenter.line({
    code: "setup.complete.agent_handoff.hint",
    text: input.text,
  });
}
