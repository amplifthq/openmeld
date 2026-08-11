import pc from "picocolors";
import type { createPresenter } from "../runtime/presenter/index";
import { formatAgentsCopy } from "./agents-text";

function normalizeDescriptionLines(description: string | string[]): string[] {
  const list = Array.isArray(description) ? description : [description];
  return list.map((line) => line.trim()).filter((line) => line.length > 0);
}

export function buildInteractiveMenuMessage(input: {
  title: string;
  description: string | string[];
}): string {
  return [
    input.title,
    ...normalizeDescriptionLines(input.description).map((line) =>
      pc.dim(formatAgentsCopy(line))
    ),
    "",
  ].join("\n");
}

export function emitInteractiveDescription(
  description: string | string[]
): void {
  const lines = normalizeDescriptionLines(description);
  if (lines.length === 0) {
    return;
  }
  process.stdout.write(
    `${lines.map((line) => pc.dim(formatAgentsCopy(line))).join("\n")}\n`
  );
}

export function emitHumanSectionDescription(
  presenter: ReturnType<typeof createPresenter>,
  input: {
    codePrefix: string;
    description: string | string[];
  }
): void {
  if (presenter.view !== "human") {
    return;
  }
  const lines = normalizeDescriptionLines(input.description);
  for (const [index, line] of lines.entries()) {
    presenter.line({
      code: `${input.codePrefix}.description.${String(index)}`,
      text: pc.dim(formatAgentsCopy(line)),
    });
  }
}

export function emitHumanSectionHeader(
  presenter: ReturnType<typeof createPresenter>,
  input: {
    codePrefix: string;
    title: string;
  }
): void {
  if (presenter.view !== "human") {
    return;
  }
  presenter.line({
    code: `${input.codePrefix}.spacer`,
    text: "",
  });
  presenter.line({
    code: `${input.codePrefix}.title`,
    text: input.title,
  });
}
