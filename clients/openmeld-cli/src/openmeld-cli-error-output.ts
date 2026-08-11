import type { LocalMachineIssue } from "@openmeld/schemas";
import { formatLocalMachineIssueMessage } from "@openmeld/schemas";
import {
  buildAgentAuthenticationGuide,
  buildHumanAuthenticationCard,
  resolveAuthenticationGuidanceFromError,
  resolveAuthenticationGuidanceFromMessage,
} from "./auth/auth-guidance";
import { resolveOpenMeldOrphanedLockIssue } from "./config/lock";
import {
  formatOpenMeldCliLine,
  formatOpenMeldCliTextBlock,
} from "./runtime/cli-entry-command";
import { buildDualViewGuideMessage } from "./runtime/dual-view-guide";
import { formatDualViewGuideForDisplay } from "./runtime/dual-view-guide-display";
import { DualViewGuideError } from "./runtime/dual-view-guide-error";
import { buildStructuredGuidePayload } from "./runtime/structured-guide-payload";
import { isLocalMachineFailureError } from "./system/local-machine-recovery";
import { renderTextInfoCard } from "./ui/info-card";
import { errLine, outJsonLine, outLine } from "./ui/io";

const GUIDE_COMMAND_LINE_RE =
  /^(?:\d+\)\s+)?(?:openmeld|openmeld-dev|openmeld-canary|npx(?: -y)? openmeld(?:@latest)?)\b/u;

type CliErrorOutput = {
  argv: string[];
  effectiveView: "auto" | "human" | "agent";
  code: string;
  message: string;
  error?: unknown;
};

const CLI_ERROR_CODE_PREFIX_RE = /^(agents\.[a-z0-9_.-]+):\s+/i;
type CliRecoveryAction = "none";

export function resolveCliErrorCode(input: {
  defaultCode: string;
  message: string;
  error?: unknown;
}): string {
  const fromErrorObject =
    typeof input.error === "object" &&
    input.error !== null &&
    "code" in input.error &&
    typeof (input.error as { code?: unknown }).code === "string"
      ? (input.error as { code: string }).code
      : "";
  if (fromErrorObject) {
    return fromErrorObject;
  }

  const fromMessage = parseCliErrorCodePrefix(input.message);
  return fromMessage ?? input.defaultCode;
}

function parseCliErrorCodePrefix(message: string): string | null {
  const match = message.match(CLI_ERROR_CODE_PREFIX_RE);
  if (!match?.[1]) {
    return null;
  }
  return match[1];
}

export function stripCliErrorCodePrefix(message: string, code: string): string {
  const prefix = `${code}:`;
  if (!message.startsWith(prefix)) {
    return message;
  }
  const stripped = message.slice(prefix.length).trimStart();
  return stripped.length > 0 ? stripped : message;
}

export function emitCliError(
  input: CliErrorOutput
): Promise<CliRecoveryAction> {
  const localMachineIssue = resolveCliLocalMachineIssue(input.error);
  const message = localMachineIssue
    ? formatLocalMachineIssueMessage(localMachineIssue)
    : input.message;
  const formattedMessage = formatOpenMeldCliTextBlock(message);
  const requestId = readCliErrorRequestId(input.error);
  const authGuidance =
    resolveAuthenticationGuidanceFromError(input.error) ??
    resolveAuthenticationGuidanceFromMessage(input.message);
  if (input.effectiveView === "agent") {
    emitAgentCliError({
      code: input.code,
      message,
      formattedMessage,
      requestId,
      error: input.error,
      localMachineIssue,
      authGuidance,
    });
    return Promise.resolve("none");
  }

  if (authGuidance) {
    const card = buildHumanAuthenticationCard({
      guidance: authGuidance,
      mode: "error",
    });
    renderTextInfoCard({
      title: card.title,
      rows: card.rows,
      emitLine: outLine,
    });
    emitCliErrorRequestIdLine(requestId);
    return Promise.resolve("none");
  }

  errLine(`error: ${formattedMessage}`);
  emitCliErrorRequestIdLine(requestId);
  return Promise.resolve("none");
}

function emitAgentCliError(input: {
  code: string;
  message: string;
  formattedMessage: string;
  requestId: string | null;
  error?: unknown;
  localMachineIssue: LocalMachineIssue | null;
  authGuidance: ReturnType<typeof resolveAuthenticationGuidanceFromError>;
}): void {
  if (input.localMachineIssue) {
    const message = formatLocalMachineIssueMessage(input.localMachineIssue);
    emitStructuredOutputDividerForAgents();
    outJsonLine({
      type: "error",
      code: input.localMachineIssue.code,
      message,
      ...(input.requestId ? { requestId: input.requestId } : {}),
      payload: {
        localMachineIssue: input.localMachineIssue,
      },
    });
    emitHumanReadableAgentViewError(message);
    return;
  }

  if (input.authGuidance) {
    const formattedGuide = formatDualViewGuideForDisplay(
      buildAgentAuthenticationGuide(input.authGuidance)
    );
    emitAgentCliStructuredGuide({
      code: input.code,
      requestId: input.requestId,
      formattedGuide,
    });
    emitHumanReadableAgentViewError(buildDualViewGuideMessage(formattedGuide));
    return;
  }

  const dualGuideError =
    input.error instanceof DualViewGuideError ? input.error : null;
  if (dualGuideError) {
    const formattedGuide = formatDualViewGuideForDisplay(dualGuideError.guide);
    emitAgentCliStructuredGuide({
      code: input.code,
      requestId: input.requestId,
      formattedGuide,
    });
    emitHumanReadableAgentViewError(buildDualViewGuideMessage(formattedGuide));
    return;
  }

  emitStructuredOutputDividerForAgents();
  outJsonLine({
    type: "error",
    code: input.code,
    message: input.formattedMessage,
    ...(input.requestId ? { requestId: input.requestId } : {}),
  });
  emitHumanReadableAgentViewError(
    buildFallbackAgentViewGuideMessage(input.message)
  );
}

function resolveCliLocalMachineIssue(error: unknown): LocalMachineIssue | null {
  if (isLocalMachineFailureError(error)) {
    return error.issue;
  }
  return resolveOpenMeldOrphanedLockIssue(error);
}

function emitAgentCliStructuredGuide(input: {
  code: string;
  requestId: string | null;
  formattedGuide: ReturnType<typeof formatDualViewGuideForDisplay>;
}): void {
  emitStructuredOutputDividerForAgents();
  outJsonLine({
    type: "error",
    code: input.code,
    message: input.formattedGuide.summary,
    ...(input.requestId ? { requestId: input.requestId } : {}),
    payload: buildStructuredGuidePayload(input.formattedGuide),
  });
}

function emitCliErrorRequestIdLine(requestId: string | null): void {
  if (!requestId) {
    return;
  }
  errLine(`Request ID: ${requestId}`);
}

export function readCliErrorRequestId(error: unknown): string | null {
  if (!error || typeof error !== "object") {
    return null;
  }

  const requestId = (error as { requestId?: unknown }).requestId;
  if (typeof requestId !== "string") {
    return null;
  }

  const normalized = requestId.trim();
  return normalized.length > 0 ? normalized : null;
}

export function canShowAgentViewRecoveryPrompt(): boolean {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

function buildFallbackAgentViewGuideMessage(message: string): string {
  const normalizedMessage = normalizeErrorSummaryForGuide(message);
  return formatOpenMeldCliTextBlock(
    buildDualViewGuideMessage({
      summary: normalizedMessage,
      humanSteps: [
        "Run `openmeld view human` in this terminal.",
        "Retry the same command in human view.",
      ],
      agentCommands: [
        "Use `openmeld <command> --help` for explicit non-interactive flags.",
      ],
      notes: [
        "You are currently in agent view.",
        `Original error: ${normalizedMessage}`,
      ],
    })
  );
}

function normalizeErrorSummaryForGuide(message: string): string {
  const firstLine = message
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  return firstLine ?? "command failed in agent view.";
}

function emitStructuredOutputDividerForAgents(): void {
  if (!process.stderr.isTTY) {
    return;
  }

  const RESET = "\u001B[0m";
  const BOLD = "\u001B[1m";
  const DIM = "\u001B[2m";
  const CYAN = "\u001B[36m";

  process.stderr.write("\n");
  process.stderr.write(
    `${BOLD}${CYAN}----- STRUCTURED OUTPUT (FOR AGENTS) -----${RESET}\n`
  );
  process.stderr.write(
    `${DIM}Machine-readable JSON block starts below.${RESET}\n`
  );
}

function emitHumanReadableAgentViewError(message: string): void {
  if (!process.stderr.isTTY) {
    return;
  }

  const hasHumanSection = message.includes("[FOR HUMAN OPERATORS]");
  const hasAgentSection = message.includes("[FOR AGENTS]");
  if (!(hasHumanSection || hasAgentSection)) {
    return;
  }

  const RESET = "\u001B[0m";
  const BOLD = "\u001B[1m";
  const DIM = "\u001B[2m";
  const RED = "\u001B[31m";
  const GREEN = "\u001B[32m";
  const YELLOW = "\u001B[33m";
  const CYAN = "\u001B[36m";

  process.stderr.write("\n");
  process.stderr.write(
    `${BOLD}${CYAN}----- HUMAN READABLE GUIDE -----${RESET}\n`
  );
  process.stderr.write(
    `${BOLD}${YELLOW}FOR AGENTS: ignore the human notes below. No further structured output follows.${RESET}\n`
  );
  const humanSteps = extractDualViewHumanSectionSteps(message);

  let skippingHumanSection = false;
  for (const rawLine of message.split("\n")) {
    const lineMeta = resolveGuideBodyLineMeta(rawLine, skippingHumanSection);
    skippingHumanSection = lineMeta.nextSkippingHumanSection;
    if (lineMeta.skip) {
      continue;
    }
    process.stderr.write(
      `${formatGuideBodyLine(rawLine, lineMeta.style, { BOLD, CYAN, RED, RESET, YELLOW })}\n`
    );
  }

  process.stderr.write("\n");
  process.stderr.write(
    `${DIM}Structured JSON for agents is printed above.${RESET}\n`
  );
  process.stderr.write(
    `${BOLD}${GREEN}If you are a human reading this.${RESET}\n`
  );
  process.stderr.write(
    `${GREEN}To switch back to Human View, run these commands in Terminal:${RESET}\n`
  );
  process.stderr.write(`${BOLD}${GREEN}[FOR HUMAN OPERATORS]${RESET}\n`);
  if (humanSteps.length > 0) {
    for (const step of humanSteps) {
      process.stderr.write(`${BOLD}${CYAN}${step}${RESET}\n`);
    }
    return;
  }
  process.stderr.write(
    `${BOLD}${CYAN}${formatOpenMeldCliLine("1) openmeld view human")}${RESET}\n`
  );
  process.stderr.write(
    `${BOLD}${CYAN}${formatOpenMeldCliLine("2) openmeld start")}${RESET}\n`
  );
}

export function emitAgentViewHumanRecoveryHint(): void {
  if (!canShowAgentViewRecoveryPrompt()) {
    return;
  }

  const RESET = "\u001B[0m";
  const BOLD = "\u001B[1m";
  const DIM = "\u001B[2m";
  const CYAN = "\u001B[36m";
  const GREEN = "\u001B[32m";
  const YELLOW = "\u001B[33m";

  process.stderr.write("\n");
  process.stderr.write(
    `${BOLD}${YELLOW}FOR AGENTS: ignore the note below. No further structured output follows.${RESET}\n`
  );
  process.stderr.write(
    `${BOLD}${GREEN}If you are a human reading this terminal.${RESET}\n`
  );
  process.stderr.write(
    `${DIM}Agent View is still active for future OpenMeld commands in this terminal.${RESET}\n`
  );
  process.stderr.write(
    `${BOLD}${CYAN}${formatOpenMeldCliLine("openmeld view human")}${RESET}\n`
  );
}

type GuideBodyLineStyle = "plain" | "agent-section" | "command" | "warning";

function resolveGuideBodyLineMeta(
  rawLine: string,
  skippingHumanSection: boolean
): {
  skip: boolean;
  nextSkippingHumanSection: boolean;
  style: GuideBodyLineStyle;
} {
  const line = rawLine.trim();
  if (line.includes("[FOR HUMAN OPERATORS]")) {
    return {
      skip: true,
      nextSkippingHumanSection: true,
      style: "plain",
    };
  }
  if (skippingHumanSection) {
    if (line.includes("[FOR AGENTS]")) {
      return {
        skip: false,
        nextSkippingHumanSection: false,
        style: "agent-section",
      };
    }
    return {
      skip: true,
      nextSkippingHumanSection: true,
      style: "plain",
    };
  }
  if (line.includes("[FOR AGENTS]")) {
    return {
      skip: false,
      nextSkippingHumanSection: false,
      style: "agent-section",
    };
  }
  if (isGuideCommandLine(line)) {
    return {
      skip: false,
      nextSkippingHumanSection: false,
      style: "command",
    };
  }
  if (line.startsWith("Agent view detected with missing")) {
    return {
      skip: false,
      nextSkippingHumanSection: false,
      style: "warning",
    };
  }
  return {
    skip: false,
    nextSkippingHumanSection: false,
    style: "plain",
  };
}

function isGuideCommandLine(line: string): boolean {
  return GUIDE_COMMAND_LINE_RE.test(line);
}

function formatGuideBodyLine(
  rawLine: string,
  style: GuideBodyLineStyle,
  colors: {
    BOLD: string;
    CYAN: string;
    RED: string;
    RESET: string;
    YELLOW: string;
  }
): string {
  if (style === "agent-section") {
    return `${colors.BOLD}${colors.YELLOW}${rawLine}${colors.RESET}`;
  }
  if (style === "command") {
    return `${colors.BOLD}${colors.CYAN}${rawLine}${colors.RESET}`;
  }
  if (style === "warning") {
    return `${colors.BOLD}${colors.RED}${rawLine}${colors.RESET}`;
  }
  return rawLine;
}

function extractDualViewHumanSectionSteps(message: string): string[] {
  const steps: string[] = [];
  let inHumanSection = false;
  for (const rawLine of message.split("\n")) {
    const line = rawLine.trim();
    if (line.includes("[FOR HUMAN OPERATORS]")) {
      inHumanSection = true;
      continue;
    }
    if (line.includes("[FOR AGENTS]")) {
      break;
    }
    if (!inHumanSection || line.length === 0) {
      continue;
    }
    steps.push(line);
  }
  return steps;
}
