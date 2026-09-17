import {
  OPEN_MELD_TOOLS_UPDATE_FAILURE_DETAIL_MAX_CHARS,
  openMeldToolsUpdateProcessFailureFrameSchema,
} from "@openmeld/schemas";
import type {
  OpenMeldToolsUpdateFailureCode,
  OpenMeldToolsUpdateProcessFailureFrame,
} from "@openmeld/schemas/types";
import { toErrorMessage } from "@openmeld/utils";
import { resolveOpenMeldToolsUpdateFailure } from "./openmeld-tools-update-failure";

const FAILURE_FRAME_OUTPUT_MAX_CHARS = 64 * 1024;
const LINE_SPLIT_RE = /\r?\n/u;

export type OpenMeldToolsUpdateProcessFailure = {
  detail: string;
  failureCode: OpenMeldToolsUpdateFailureCode;
};

export function emitOpenMeldToolsUpdateFailureFrame(error: unknown): void {
  const detail = truncateText(
    toErrorMessage(error),
    OPEN_MELD_TOOLS_UPDATE_FAILURE_DETAIL_MAX_CHARS
  );
  const frame: OpenMeldToolsUpdateProcessFailureFrame =
    openMeldToolsUpdateProcessFailureFrameSchema.parse({
      detail: detail || "OpenMeld update process failed.",
      failureCode:
        resolveOpenMeldToolsUpdateFailure(error) ?? "cli.update.failed",
      schema: "openmeld-tools-update-process-failure-v1",
      v: 1,
    });
  // The leading newline keeps the frame parseable even when prior presenter
  // output ended mid-line.
  process.stdout.write(`\n${JSON.stringify(frame)}\n`);
}

export function appendBoundedOpenMeldToolsUpdateProcessOutput(
  current: string,
  chunk: string
): string {
  return truncateText(
    `${current}${chunk}`,
    FAILURE_FRAME_OUTPUT_MAX_CHARS,
    "tail"
  );
}

export function parseOpenMeldToolsUpdateFailureFrame(
  output: string
): OpenMeldToolsUpdateProcessFailure | null {
  const lines = output.split(LINE_SPLIT_RE);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index]?.trim();
    if (!line?.startsWith("{")) {
      continue;
    }
    try {
      const parsed = openMeldToolsUpdateProcessFailureFrameSchema.safeParse(
        JSON.parse(line) as unknown
      );
      if (parsed.success) {
        return {
          detail: parsed.data.detail,
          failureCode: parsed.data.failureCode,
        };
      }
    } catch {
      // Other agent-view output and truncated lines are not update frames.
    }
  }
  return null;
}

function truncateText(
  value: string,
  maxChars: number,
  side: "head" | "tail" = "head"
): string {
  if (value.length <= maxChars) {
    return value;
  }
  if (side === "tail") {
    return value.slice(-maxChars);
  }
  const suffix = "…";
  return value.slice(0, Math.max(0, maxChars - suffix.length)) + suffix;
}
