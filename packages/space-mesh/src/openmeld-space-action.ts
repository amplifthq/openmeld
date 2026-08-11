import {
  normalizeMessageEnvelope,
  openMeldSpaceActionSchema,
  openMeldSpaceEgressActionSchema,
} from "@openmeld/schemas";
import type {
  OpenMeldSpaceAction,
  OpenMeldSpaceEgressAction,
} from "@openmeld/schemas/types";

const STRUCTURED_ACTION_BLOCK_INFO_STRING = "openmeld-space-action";
const STRUCTURED_ACTION_BLOCK_RE =
  /(?:\r?\n)?```openmeld-space-action\s*\r?\n([\s\S]*?)\r?\n```\s*$/;
const STRUCTURED_ACTION_BLOCK_LINE_BREAK_RE = /\r?\n/u;
const STRUCTURED_ACTION_BLOCK_HEADER_PART_RE = /\s+/u;
const STRUCTURED_ACTION_BLOCK_PARSE_ERROR =
  "OpenMeld Space structured action block must be valid JSON or simple OpenMeld action syntax";
const TRAILING_JSON_ACTION_PARSE_ERROR =
  "OpenMeld Space trailing JSON action must be a valid JSON object";

export type OpenMeldSpaceActionCarrierKind =
  | "fenced_block"
  | "invalid_json"
  | "none"
  | "trailing_json";

export function normalizeOpenMeldSpaceAction(
  input: unknown
): OpenMeldSpaceAction {
  const parsed = openMeldSpaceActionSchema.safeParse(input);
  if (parsed.success) {
    return parsed.data;
  }
  throw new Error(
    parsed.error.issues[0]?.message ?? "OpenMeld Space Action is invalid"
  );
}

export function normalizeOpenMeldSpaceEgressActionInput(
  input: unknown
): unknown {
  if (!isRecord(input)) {
    return input;
  }

  const action = { ...input };
  switch (action.type) {
    case "post_message":
      return normalizePostMessageEgressActionInput(action);
    case "post_status":
      return normalizePostStatusEgressActionInput(action);
    case "stay_silent":
      return normalizeStaySilentEgressActionInput(action);
    default:
      return action;
  }
}

export function hydrateOpenMeldSpaceEgressActionInputFromCleanedOutput(input: {
  action: unknown;
  cleanedOutput: string;
}): unknown {
  if (!(input.action && typeof input.action === "object")) {
    return input.action;
  }

  const cleanedOutput = input.cleanedOutput.trim();
  if (!cleanedOutput) {
    return input.action;
  }

  const action = {
    ...(input.action as Record<string, unknown>),
  };
  if (
    action.type === "post_message" &&
    typeof action.text !== "string" &&
    typeof action.message !== "string"
  ) {
    return {
      ...action,
      text: cleanedOutput,
    };
  }
  if (
    action.type === "post_status" &&
    typeof action.text !== "string" &&
    typeof action.note !== "string"
  ) {
    return {
      ...action,
      text: cleanedOutput,
    };
  }
  return action;
}

export function normalizeOpenMeldSpaceEgressAction(
  input: unknown
): OpenMeldSpaceEgressAction {
  const parsed = openMeldSpaceEgressActionSchema.safeParse(
    shouldSkipSharedPostMessageNormalization(input)
      ? input
      : normalizeOpenMeldSpaceEgressActionInput(input)
  );
  if (parsed.success) {
    return parsed.data;
  }
  throw new Error(
    parsed.error.issues[0]?.message ?? "OpenMeld Space egress action is invalid"
  );
}

function shouldSkipSharedPostMessageNormalization(input: unknown): boolean {
  if (!(input && typeof input === "object" && !Array.isArray(input))) {
    return false;
  }

  const action = input as Record<string, unknown>;
  return (
    action.type === "post_message" &&
    !(action.messageEnvelope && typeof action.messageEnvelope === "object")
  );
}

export function extractTrailingStructuredSpaceActionBlock(input: {
  output: string;
}): {
  carrierKind: OpenMeldSpaceActionCarrierKind;
  cleanedOutput: string;
  action: OpenMeldSpaceEgressAction | null;
  infoString: typeof STRUCTURED_ACTION_BLOCK_INFO_STRING;
} {
  const extraction = tryExtractTrailingStructuredSpaceActionBlock(input);
  if (extraction.parseError) {
    throw new Error(extraction.parseError);
  }
  return {
    carrierKind: extraction.carrierKind,
    cleanedOutput: extraction.cleanedOutput,
    action: extraction.action,
    infoString: extraction.infoString,
  };
}

export function tryExtractTrailingStructuredSpaceActionBlock(input: {
  output: string;
}): {
  carrierKind: OpenMeldSpaceActionCarrierKind;
  cleanedOutput: string;
  action: OpenMeldSpaceEgressAction | null;
  infoString: typeof STRUCTURED_ACTION_BLOCK_INFO_STRING;
  parseError: string | null;
} {
  const rawOutput = typeof input.output === "string" ? input.output : "";
  const trimmedOutput = rawOutput.trimEnd();
  if (trimmedOutput.length === 0) {
    return {
      carrierKind: "none",
      cleanedOutput: trimmedOutput,
      action: null,
      infoString: STRUCTURED_ACTION_BLOCK_INFO_STRING,
      parseError: null,
    };
  }

  let output: string;
  try {
    output = normalizeOutput(rawOutput);
  } catch (error) {
    return {
      carrierKind: "invalid_json",
      cleanedOutput: trimmedOutput,
      action: null,
      infoString: STRUCTURED_ACTION_BLOCK_INFO_STRING,
      parseError:
        error instanceof Error
          ? error.message
          : "OpenMeld Space structured action output is invalid",
    };
  }
  const matched = STRUCTURED_ACTION_BLOCK_RE.exec(output);
  if (!matched) {
    return extractTrailingStandaloneJsonSpaceAction({
      output,
      infoString: STRUCTURED_ACTION_BLOCK_INFO_STRING,
    });
  }

  const cleanedOutput = resolveInvalidBlockFallbackOutput({
    matchedIndex: matched.index,
    output,
  });
  const blockText = matched[1]?.trim() ?? "";
  if (blockText.length === 0) {
    return {
      carrierKind: "fenced_block",
      cleanedOutput,
      action: null,
      infoString: STRUCTURED_ACTION_BLOCK_INFO_STRING,
      parseError: "OpenMeld Space structured action block is empty",
    };
  }

  const parsedBlock = tryParseStructuredSpaceActionBlockInput(blockText);
  if (!(parsedBlock.actionInput && !parsedBlock.parseError)) {
    return {
      carrierKind: "fenced_block",
      cleanedOutput,
      action: null,
      infoString: STRUCTURED_ACTION_BLOCK_INFO_STRING,
      parseError: parsedBlock.parseError,
    };
  }

  try {
    const action = normalizeExtractedOpenMeldSpaceEgressAction(
      hydrateOpenMeldSpaceEgressActionInputFromCleanedOutput({
        action: parsedBlock.actionInput,
        cleanedOutput,
      })
    );
    return {
      carrierKind: "fenced_block",
      cleanedOutput: output.slice(0, matched.index).trimEnd(),
      action,
      infoString: STRUCTURED_ACTION_BLOCK_INFO_STRING,
      parseError: null,
    };
  } catch (error) {
    return {
      carrierKind: "fenced_block",
      cleanedOutput,
      action: null,
      infoString: STRUCTURED_ACTION_BLOCK_INFO_STRING,
      parseError:
        error instanceof Error
          ? error.message
          : "OpenMeld Space egress action is invalid",
    };
  }
}

function extractTrailingStandaloneJsonSpaceAction(input: {
  infoString: typeof STRUCTURED_ACTION_BLOCK_INFO_STRING;
  output: string;
}): {
  carrierKind: OpenMeldSpaceActionCarrierKind;
  cleanedOutput: string;
  action: OpenMeldSpaceEgressAction | null;
  infoString: typeof STRUCTURED_ACTION_BLOCK_INFO_STRING;
  parseError: string | null;
} {
  const candidates = resolveTrailingStandaloneJsonActionCandidates(
    input.output
  );
  if (candidates.length === 0) {
    return {
      carrierKind: "none",
      cleanedOutput: input.output,
      action: null,
      infoString: input.infoString,
      parseError: null,
    };
  }

  let parseError: string = TRAILING_JSON_ACTION_PARSE_ERROR;
  for (const candidate of candidates) {
    const parsedJson = parseStructuredSpaceActionBlockJson(candidate.jsonText);
    if (
      !(
        parsedJson &&
        typeof parsedJson === "object" &&
        !Array.isArray(parsedJson)
      )
    ) {
      continue;
    }

    try {
      const action = normalizeExtractedOpenMeldSpaceEgressAction(
        hydrateOpenMeldSpaceEgressActionInputFromCleanedOutput({
          action: parsedJson,
          cleanedOutput: candidate.cleanedOutput,
        })
      );
      return {
        carrierKind: "trailing_json",
        cleanedOutput: candidate.cleanedOutput,
        action,
        infoString: input.infoString,
        parseError: null,
      };
    } catch (error) {
      if (parseError === TRAILING_JSON_ACTION_PARSE_ERROR) {
        parseError =
          error instanceof Error
            ? error.message
            : "OpenMeld Space egress action is invalid";
      }
    }
  }

  return {
    carrierKind: "invalid_json",
    cleanedOutput: input.output,
    action: null,
    infoString: input.infoString,
    parseError,
  };
}

export function tryParseStructuredSpaceActionBlockInput(blockText: string): {
  actionInput: unknown | null;
  parseError: string | null;
} {
  const normalizedBlockText = blockText.trim();
  if (normalizedBlockText.length === 0) {
    return {
      actionInput: null,
      parseError: "OpenMeld Space structured action block is empty",
    };
  }

  const parsedJson = parseStructuredSpaceActionBlockJson(normalizedBlockText);
  if (parsedJson) {
    return {
      actionInput: parsedJson,
      parseError: null,
    };
  }

  const parsedSimpleAction =
    parseSimpleStructuredSpaceActionBlock(normalizedBlockText);
  if (parsedSimpleAction) {
    return {
      actionInput: parsedSimpleAction,
      parseError: null,
    };
  }

  return {
    actionInput: null,
    parseError: STRUCTURED_ACTION_BLOCK_PARSE_ERROR,
  };
}

function normalizeOutput(value: string): string {
  const normalized = value.trimEnd();
  if (normalized.length > 0) {
    return normalized;
  }
  throw new Error("output is required");
}

function resolveTrailingStandaloneJsonActionCandidates(output: string): Array<{
  cleanedOutput: string;
  jsonText: string;
}> {
  const candidateOutput = output.trimEnd();
  if (!candidateOutput.endsWith("}")) {
    return [];
  }

  return resolveTrailingStandaloneJsonLineStartIndices(candidateOutput)
    .map((startIndex) => {
      const jsonText = candidateOutput.slice(startIndex).trim();
      return {
        cleanedOutput: candidateOutput.slice(0, startIndex).trimEnd(),
        jsonText,
      };
    })
    .filter(
      (candidate) =>
        candidate.jsonText.startsWith("{") && candidate.jsonText.endsWith("}")
    );
}

function resolveTrailingStandaloneJsonLineStartIndices(
  output: string
): number[] {
  const lineStartIndices: number[] = [];
  let lineStartIndex = 0;
  for (let index = 0; index <= output.length; index += 1) {
    const isLineBreak = index === output.length || output[index] === "\n";
    if (!isLineBreak) {
      continue;
    }
    let candidateStartIndex = lineStartIndex;
    while (
      candidateStartIndex < index &&
      (output[candidateStartIndex] === " " ||
        output[candidateStartIndex] === "\t")
    ) {
      candidateStartIndex += 1;
    }
    if (output[candidateStartIndex] === "{") {
      lineStartIndices.push(candidateStartIndex);
    }
    lineStartIndex = index + 1;
  }
  return lineStartIndices.reverse();
}

function resolveInvalidBlockFallbackOutput(input: {
  matchedIndex: number;
  output: string;
}): string {
  const cleanedOutput = input.output.slice(0, input.matchedIndex).trimEnd();
  return cleanedOutput.length > 0 ? cleanedOutput : "";
}

function parseStructuredSpaceActionBlockJson(
  blockText: string
): unknown | null {
  try {
    return JSON.parse(blockText);
  } catch {
    const repairedBlockText = appendMissingJsonClosers(blockText);
    if (!repairedBlockText || repairedBlockText === blockText) {
      return null;
    }
    try {
      return JSON.parse(repairedBlockText);
    } catch {
      return null;
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function normalizePostMessageEgressActionInput(
  action: Record<string, unknown>
): Record<string, unknown> {
  const { message, messageEnvelope, replyTo, text, ...rest } = action;
  if (isRecord(messageEnvelope)) {
    return {
      ...rest,
      messageEnvelope: normalizeMessageEnvelope(messageEnvelope),
    };
  }

  const rawText = resolveLegacyPostMessageText({ message, text });
  if (typeof rawText !== "string") {
    return rest;
  }

  const rawReplyToSignalId = resolveLegacyReplyToSignalId(replyTo);
  return {
    ...rest,
    messageEnvelope: normalizeMessageEnvelope({
      ...(rawReplyToSignalId ? { replyToSignalId: rawReplyToSignalId } : {}),
      text: rawText,
    }),
  };
}

function resolveLegacyPostMessageText(input: {
  message: unknown;
  text: unknown;
}): string | undefined {
  if (typeof input.text === "string") {
    return input.text;
  }
  if (typeof input.message === "string") {
    return input.message;
  }
  return undefined;
}

function resolveLegacyReplyToSignalId(value: unknown): string | undefined {
  if (!isRecord(value) || typeof value.signalId !== "string") {
    return undefined;
  }
  return value.signalId;
}

function normalizePostStatusEgressActionInput(
  action: Record<string, unknown>
): Record<string, unknown> {
  const { note, ...rest } = action;
  if (typeof rest.text !== "string" && typeof note === "string") {
    return {
      ...rest,
      text: note.trim(),
    };
  }
  return rest;
}

function normalizeStaySilentEgressActionInput(
  action: Record<string, unknown>
): Record<string, unknown> {
  const { note, ...rest } = action;
  if (typeof rest.reason !== "string" && typeof note === "string") {
    return {
      ...rest,
      reason: note.trim(),
    };
  }
  return rest;
}

function parseSimpleStructuredSpaceActionBlock(
  blockText: string
): Record<string, unknown> | null {
  const normalizedLines = trimSimpleStructuredActionOuterEmptyLines(
    blockText.split(STRUCTURED_ACTION_BLOCK_LINE_BREAK_RE)
  );
  const [rawHeader, ...bodyLines] = normalizedLines;
  const parsedHeader = parseSimpleStructuredActionHeader(rawHeader);
  if (!parsedHeader) {
    return null;
  }

  switch (parsedHeader.actionType) {
    case "post_message":
      return buildSimplePostMessageAction({
        bodyLines,
        headerBody: parsedHeader.headerBody,
      });
    case "stay_silent":
      return buildSimpleStaySilentAction({
        bodyLines,
        headerBody: parsedHeader.headerBody,
      });
    case "post_status":
      return buildSimplePostStatusAction({
        bodyLines,
        headerArgs: parsedHeader.headerArgs,
      });
    default:
      return null;
  }
}

function parseSimpleStructuredActionHeader(rawHeader: string | undefined): {
  actionType: string;
  headerArgs: string[];
  headerBody: string;
} | null {
  const header = rawHeader?.trim();
  if (!header) {
    return null;
  }
  const [rawActionType, ...headerArgs] = header.split(
    STRUCTURED_ACTION_BLOCK_HEADER_PART_RE
  );
  const actionType = rawActionType?.trim();
  if (!actionType) {
    return null;
  }
  return {
    actionType,
    headerArgs,
    headerBody: headerArgs.join(" ").trim(),
  };
}

function buildSimplePostMessageAction(input: {
  bodyLines: string[];
  headerBody: string;
}): Record<string, unknown> {
  const text = joinSimpleStructuredActionTextParts([
    input.headerBody,
    joinSimpleStructuredActionText(
      input.headerBody
        ? input.bodyLines
        : trimSingleLeadingEmptyLine(input.bodyLines)
    ),
  ]);
  return text ? { type: "post_message", text } : { type: "post_message" };
}

function buildSimpleStaySilentAction(input: {
  bodyLines: string[];
  headerBody: string;
}): Record<string, unknown> {
  const reason = joinSimpleStructuredActionTextParts([
    input.headerBody,
    joinSimpleStructuredActionText(
      input.headerBody
        ? input.bodyLines
        : trimSingleLeadingEmptyLine(input.bodyLines)
    ),
  ]);
  return reason ? { type: "stay_silent", reason } : { type: "stay_silent" };
}

function buildSimplePostStatusAction(input: {
  bodyLines: string[];
  headerArgs: string[];
}): Record<string, unknown> | null {
  const statusFromHeader = input.headerArgs[0]?.trim();
  const headerNote = input.headerArgs.slice(1).join(" ").trim();
  const bodyLinesAfterSingleSpacer = trimSingleLeadingEmptyLine(
    input.bodyLines
  );
  const status = statusFromHeader || bodyLinesAfterSingleSpacer[0]?.trim();
  if (!status) {
    return null;
  }

  let textLines: string[];
  if (statusFromHeader) {
    textLines = headerNote
      ? [headerNote, ...input.bodyLines]
      : trimSingleLeadingEmptyLine(input.bodyLines);
  } else {
    textLines = trimSingleLeadingEmptyLine(bodyLinesAfterSingleSpacer.slice(1));
  }

  const text = joinSimpleStructuredActionText(textLines);
  return text
    ? { type: "post_status", status, text }
    : { type: "post_status", status };
}

function trimSimpleStructuredActionOuterEmptyLines(lines: string[]): string[] {
  const nextLines = [...lines];
  if (nextLines[0]?.trim() === "") {
    nextLines.shift();
  }
  if (nextLines.at(-1)?.trim() === "") {
    nextLines.pop();
  }
  return nextLines;
}

function trimSingleLeadingEmptyLine(lines: string[]): string[] {
  return lines[0]?.trim() === "" ? lines.slice(1) : lines;
}

function joinSimpleStructuredActionText(lines: string[]): string | null {
  const text = lines.join("\n");
  return text.trim().length > 0 ? text : null;
}

function joinSimpleStructuredActionTextParts(
  parts: Array<string | null | undefined>
): string | null {
  const definedParts = parts.filter(
    (part): part is string => typeof part === "string" && part.trim().length > 0
  );
  if (definedParts.length === 0) {
    return null;
  }
  return definedParts.join("\n");
}

function normalizeExtractedOpenMeldSpaceEgressAction(
  input: unknown
): OpenMeldSpaceEgressAction {
  const normalizedInput = normalizeOpenMeldSpaceEgressActionInput(input);
  const parsed = openMeldSpaceEgressActionSchema.safeParse(normalizedInput);
  if (!parsed.success) {
    throw new Error(
      parsed.error.issues[0]?.message ??
        "OpenMeld Space egress action is invalid"
    );
  }
  if (!(normalizedInput && typeof normalizedInput === "object")) {
    return parsed.data;
  }

  if (parsed.data.type === "post_status") {
    const preservedText = (normalizedInput as { text?: unknown }).text;
    if (typeof preservedText === "string" && preservedText.trim().length > 0) {
      return {
        ...parsed.data,
        text: preservedText,
      };
    }
  }
  if (
    parsed.data.type === "post_message" &&
    "messageEnvelope" in normalizedInput &&
    normalizedInput.messageEnvelope &&
    typeof normalizedInput.messageEnvelope === "object"
  ) {
    const preservedText = (
      normalizedInput.messageEnvelope as { text?: unknown }
    ).text;
    if (typeof preservedText === "string" && preservedText.trim().length > 0) {
      return {
        ...parsed.data,
        messageEnvelope: {
          ...parsed.data.messageEnvelope,
          text: preservedText,
        },
      };
    }
  }
  return parsed.data;
}

function appendMissingJsonClosers(blockText: string): string | null {
  const stack: string[] = [];
  let inString = false;
  let escaped = false;

  for (const character of blockText) {
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === "\\") {
      escaped = true;
      continue;
    }
    if (character === '"') {
      inString = !inString;
      continue;
    }
    if (inString) {
      continue;
    }
    if (character === "{") {
      stack.push("}");
      continue;
    }
    if (character === "[") {
      stack.push("]");
      continue;
    }
    if (
      (character === "}" || character === "]") &&
      stack.at(-1) === character
    ) {
      stack.pop();
    }
  }

  if (inString || stack.length === 0) {
    return null;
  }
  return `${blockText}${stack.reverse().join("")}`;
}
