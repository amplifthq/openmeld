export type CodexStdoutLineProcessResult = {
  outputUpdated: boolean;
  previewable: boolean;
  terminal: boolean;
};

export function processCodexStdoutLine(input: {
  latestOutputRef: {
    value: string;
  };
  line: string;
  threadIdRef: {
    value: string | null;
  };
}): CodexStdoutLineProcessResult {
  const normalizedLine = input.line.trim();
  if (!normalizedLine) {
    return {
      outputUpdated: false,
      previewable: false,
      terminal: false,
    };
  }

  const maybeThreadId = extractThreadIdFromCodexLine(normalizedLine);
  if (maybeThreadId) {
    input.threadIdRef.value = maybeThreadId;
  }

  const maybeOutput = extractOutputFromCodexLine(normalizedLine);
  if (maybeOutput) {
    input.latestOutputRef.value = maybeOutput.text;
    return {
      outputUpdated: true,
      previewable: maybeOutput.previewable,
      terminal: maybeOutput.terminal,
    };
  }

  if (isCodexTerminalControlLine(normalizedLine)) {
    return {
      outputUpdated: false,
      previewable: false,
      terminal: true,
    };
  }

  return {
    outputUpdated: false,
    previewable: false,
    terminal: false,
  };
}

function extractOutputFromCodexLine(line: string): {
  previewable: boolean;
  terminal: boolean;
  text: string;
} | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return null;
  }
  const record =
    parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  if (!record) {
    return null;
  }

  const item =
    record.item &&
    typeof record.item === "object" &&
    !Array.isArray(record.item)
      ? (record.item as Record<string, unknown>)
      : null;
  const response =
    record.response &&
    typeof record.response === "object" &&
    !Array.isArray(record.response)
      ? (record.response as Record<string, unknown>)
      : null;

  if (record.type === "item.completed" && item?.type === "agent_message") {
    const phase = normalizeOptionalText(item.phase ?? record.phase);
    if (phase && phase !== "final_answer") {
      return null;
    }
    const text = normalizeOptionalText(item.text);
    return text
      ? {
          previewable: false,
          terminal: true,
          text,
        }
      : null;
  }
  if (record.type === "response.completed") {
    const text = normalizeOptionalText(response?.output_text);
    return text
      ? {
          previewable: false,
          terminal: true,
          text,
        }
      : null;
  }
  return null;
}

function isCodexTerminalControlLine(line: string): boolean {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return false;
  }
  const record =
    parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  if (!record) {
    return false;
  }
  return (
    record.type === "turn.completed" ||
    record.type === "turn.failed" ||
    record.type === "error"
  );
}

function extractThreadIdFromCodexLine(line: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return null;
  }
  const record =
    parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  if (!record) {
    return null;
  }
  if (record.type !== "thread.started") {
    return null;
  }
  return normalizeOptionalText(record.thread_id);
}

function normalizeText(value: unknown): string {
  return String(value ?? "").trim();
}

function normalizeOptionalText(value: unknown): string | null {
  const normalized = normalizeText(value);
  return normalized.length > 0 ? normalized : null;
}
