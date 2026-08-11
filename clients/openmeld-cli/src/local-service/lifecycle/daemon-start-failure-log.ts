import { readFile, stat } from "node:fs/promises";
import { getDaemonSystemServiceLogPath } from "./daemon-service-manager";

const LOG_NOISE_PATTERNS = [
  /^starting local service loop/i,
  /^daemon stream connected/i,
  /^registered daemon session/i,
  /^catalog sync/i,
  /^heartbeat /i,
  /^profile initialized/i,
];

const LOG_ERROR_HINT_PATTERN =
  /error:|failed|exception|cannot find module|module_not_found|permission denied|operation not permitted|not authorized|no openmeld profile is selected|econnrefused|fetch failed|connection refused|etimedout|timed out|enotfound|eai_again|dns/i;
const LOG_STACK_TRACE_PATTERN = /^\s*at\s+/i;
const LOG_WHITESPACE_PATTERN = /\s+/g;
const LOG_ERROR_PREFIX_PATTERN = /^error:\s*/i;
const LOG_LINE_SPLIT_PATTERN = /\r?\n/;
const LOG_DETAIL_MAX_LENGTH = 160;
const PRESENTATION_BORDER_ONLY_PATTERN =
  /^[\s│┆┃┊┌┐└┘├┤╭╮╰╯─━═╴╵╶╷╸╹╺╻╼╽╾╿█▁▂▃▄▅▆▇▀■□◆◇●○◌◦•·…]+$/u;
const PRESENTATION_PREFIX_PATTERN =
  /^(OPENMELD CLI|People and agents, working as one\.|Setup Check|Welcome|Your current OpenMeld Identity|OpenMeld Service Needs Attention|OpenMeld Service Needs Refresh|OpenMeld Service Needs Repair|OpenMeld Service Update Required|OpenMeld Service Started|Which profile do you want to use\?|Continue as\b|Use another profile\b|Create a new profile\b|Exit\b|Status:|Automatic Repair:|Found:|Last local detail:|What this means:|OpenMeld Service:|OpenMeld Connection:|Runtime:|Device Reply Readiness:|Device Reply Setup:|Local Service Link:|Current Agent Reply Readiness:|Current Local Service Link:|Next:|Signed In:|Gateway:|Profile Name:|Type:|Start OpenMeld Service now\b)/i;
const PRESENTATION_LEADING_CHROME_PATTERN = /^[\s│┆┃┊┌┐└┘├┤╭╮╰╯◆◇■●○]+/u;
const PRESENTATION_LEADING_DECORATION_PATTERN = /^[^\p{L}\p{N}`]+/u;

export type DaemonStartFailureLogDiagnostic = {
  detail: string;
  rawLine: string;
};

export type DaemonStartFailureLogCursor = {
  size: number;
};

export async function captureDaemonStartFailureLogCursor(): Promise<DaemonStartFailureLogCursor | null> {
  const stats = await stat(getDaemonSystemServiceLogPath()).catch(() => null);
  if (!stats?.isFile()) {
    return null;
  }
  return {
    size: stats.size,
  };
}

export async function readDaemonStartFailureLogDiagnostic(
  input: { cursor?: DaemonStartFailureLogCursor | null } = {}
): Promise<DaemonStartFailureLogDiagnostic | null> {
  const rawBuffer = await readFile(getDaemonSystemServiceLogPath()).catch(
    () => null
  );
  const relevantBuffer = sliceDaemonStartFailureLogBuffer({
    rawBuffer,
    cursor: input.cursor ?? null,
  });
  if (!relevantBuffer) {
    return null;
  }
  const raw = relevantBuffer.toString("utf8");

  const rawLine = selectRelevantDaemonStartFailureLogLine(raw);
  if (!rawLine) {
    return null;
  }

  return {
    detail: summarizeDaemonStartFailureLogLine(rawLine),
    rawLine,
  };
}

function sliceDaemonStartFailureLogBuffer(input: {
  rawBuffer: Buffer | null;
  cursor: DaemonStartFailureLogCursor | null;
}): Buffer | null {
  if (!input.rawBuffer || input.rawBuffer.length === 0) {
    return null;
  }
  if (!input.cursor) {
    return input.rawBuffer;
  }
  if (input.rawBuffer.length === input.cursor.size) {
    return null;
  }
  if (input.rawBuffer.length < input.cursor.size) {
    return input.rawBuffer;
  }
  return input.rawBuffer.subarray(input.cursor.size);
}

export async function readDaemonStartFailureLogTailLines(input: {
  maxLines: number;
}): Promise<string[]> {
  if (input.maxLines <= 0) {
    return [];
  }
  const rawBuffer = await readFile(getDaemonSystemServiceLogPath()).catch(
    () => null
  );
  if (!rawBuffer || rawBuffer.length === 0) {
    return [];
  }
  const lines = rawBuffer
    .toString("utf8")
    .split(LOG_LINE_SPLIT_PATTERN)
    .map((line) => normalizeLogLine(line))
    .filter((line) => line.length > 0)
    .filter((line) => !LOG_STACK_TRACE_PATTERN.test(line))
    .filter((line) => !isLogNoise(line));
  return lines.slice(-input.maxLines);
}

export function selectRelevantDaemonStartFailureLogLine(
  rawLog: string
): string | null {
  const lines = rawLog
    .split(LOG_LINE_SPLIT_PATTERN)
    .map((line) => normalizeLogLine(line))
    .filter((line) => line.length > 0)
    .filter((line) => !LOG_STACK_TRACE_PATTERN.test(line));

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index];
    if (!line || isLogNoise(line)) {
      continue;
    }
    if (LOG_ERROR_HINT_PATTERN.test(line)) {
      return line;
    }
  }

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index];
    if (!line || isLogNoise(line)) {
      continue;
    }
    return line;
  }

  return null;
}

export function summarizeDaemonStartFailureLogLine(rawLine: string): string {
  const line = stripLogErrorPrefix(normalizeLogLine(rawLine));
  if (line.length === 0) {
    return "OpenMeld wrote a local service error, but it could not be summarized yet.";
  }

  const normalized = line.toLowerCase();
  if (normalized.includes("no openmeld profile is selected")) {
    return "OpenMeld Service could not find a usable OpenMeld identity for this device.";
  }
  if (normalized.includes("cannot find package")) {
    return "OpenMeld Service is missing a local dependency it needs to start.";
  }
  if (
    normalized.includes("cannot find module") ||
    normalized.includes("module_not_found")
  ) {
    return "OpenMeld Service is still pointing at a local CLI file that no longer exists.";
  }
  if (
    normalized.includes("permission denied") ||
    normalized.includes("operation not permitted") ||
    normalized.includes("not authorized")
  ) {
    return "OpenMeld Service is missing a local macOS permission it needs to start.";
  }
  if (isDaemonStartFailureLikelyDependencyRequestFailure(rawLine)) {
    return "OpenMeld Service started locally, but an OpenMeld dependency request failed before startup completed.";
  }

  return trimLogDetail(line, LOG_DETAIL_MAX_LENGTH);
}

export function isDaemonStartFailureLikelyDependencyRequestFailure(
  rawLine: string
): boolean {
  const normalized = stripLogErrorPrefix(
    normalizeLogLine(rawLine)
  ).toLowerCase();
  return (
    normalized.includes("econnrefused") ||
    normalized.includes("connection refused") ||
    normalized.includes("fetch failed") ||
    normalized.includes("etimedout") ||
    normalized.includes("timed out") ||
    normalized.includes("enotfound") ||
    normalized.includes("eai_again") ||
    normalized.includes("dns")
  );
}

function normalizeLogLine(value: string): string {
  return stripAnsiEscapeSequences(value)
    .trim()
    .replace(LOG_WHITESPACE_PATTERN, " ");
}

function stripLogErrorPrefix(value: string): string {
  return value.replace(LOG_ERROR_PREFIX_PATTERN, "");
}

function isLogNoise(line: string): boolean {
  return (
    LOG_NOISE_PATTERNS.some((pattern) => pattern.test(line)) ||
    isPresentationNoise(line)
  );
}

function trimLogDetail(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength - 1).trimEnd()}…`;
}

function stripAnsiEscapeSequences(value: string): string {
  let sanitized = "";

  for (let index = 0; index < value.length; index += 1) {
    const current = value[index];
    if (current !== "\u001B") {
      sanitized += current;
      continue;
    }

    const next = value[index + 1];
    if (next === "[") {
      index = consumeAnsiControlSequence(value, index + 2);
      continue;
    }
    if (next === "]") {
      index = consumeAnsiOperatingSystemCommand(value, index + 2);
    }
  }

  return sanitized;
}

function isPresentationNoise(line: string): boolean {
  if (PRESENTATION_BORDER_ONLY_PATTERN.test(line)) {
    return true;
  }

  const presenterText = line
    .replace(PRESENTATION_LEADING_CHROME_PATTERN, "")
    .replace(PRESENTATION_LEADING_DECORATION_PATTERN, "");
  return PRESENTATION_PREFIX_PATTERN.test(presenterText);
}

function consumeAnsiControlSequence(value: string, startIndex: number): number {
  for (let index = startIndex; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0x40 && code <= 0x7e) {
      return index;
    }
  }
  return value.length;
}

function consumeAnsiOperatingSystemCommand(
  value: string,
  startIndex: number
): number {
  for (let index = startIndex; index < value.length; index += 1) {
    const current = value[index];
    if (current === "\u0007") {
      return index;
    }
    if (current === "\u001B" && value[index + 1] === "\\") {
      return index + 1;
    }
  }
  return value.length;
}
