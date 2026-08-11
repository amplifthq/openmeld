import { cancel, isCancel, password as passwordPrompt } from "@clack/prompts";
import {
  normalizeSpacePasswordText,
  SPACE_PASSWORD_MIN_LENGTH,
} from "@openmeld/schemas";
import type { createPresenter } from "../runtime/presenter/index";
import { parseHttpFailure } from "./http-failure";

const HTTP_ERROR_MESSAGE_REGEX = /^HTTP\s+(\d{3})\s*:\s*([\s\S]*)$/i;
const SPACE_PASSWORD_REQUIRED_HINT_REGEX =
  /\bspace[.\s]+password[.\s]+required\b/i;
const SPACE_PASSWORD_INVALID_HINT_REGEX =
  /\bspace[.\s]+password[.\s]+invalid\b/i;

export type SpacePasswordPromptReason = "required" | "invalid";

type PasswordPromptPresenter = Pick<ReturnType<typeof createPresenter>, "line">;

export function validateSpacePasswordInput(
  value: string | undefined
): string | undefined {
  const normalized = normalizeSpacePasswordInput(value);
  if (normalized.length === 0) {
    return "Enter a password.";
  }
  if (normalized.length < SPACE_PASSWORD_MIN_LENGTH) {
    return `Use at least ${SPACE_PASSWORD_MIN_LENGTH} characters.`;
  }
  return undefined;
}

export function buildSpacePasswordRequirementsText(): string {
  return `at least ${SPACE_PASSWORD_MIN_LENGTH} characters; numbers, letters, and symbols are allowed.`;
}

export function resolveSpacePasswordPromptReason(
  error: unknown
): SpacePasswordPromptReason | null {
  const parsed = parseHttpErrorMessage(error);
  const rawMessage = toErrorMessage(error);
  if (!parsed) {
    if (isLegacyPlainPasswordError(rawMessage, "required")) {
      return "required";
    }
    if (isLegacyPlainPasswordError(rawMessage, "invalid")) {
      return "invalid";
    }
    return null;
  }

  const code = parsed.code.toLowerCase();

  if (
    code === "space.password_required" ||
    isWrappedHttpPasswordError(parsed, "required")
  ) {
    return "required";
  }
  if (
    code === "space.password_invalid" ||
    isWrappedHttpPasswordError(parsed, "invalid")
  ) {
    return "invalid";
  }
  return null;
}

function isLegacyPlainPasswordError(
  message: string,
  reason: SpacePasswordPromptReason
): boolean {
  const normalized = message.trim().toLowerCase();
  if (reason === "required") {
    return normalized === "space password required";
  }
  return normalized === "space password invalid";
}

function isWrappedHttpPasswordError(
  parsed: {
    body: string;
    code: string;
    message: string;
    status: number;
  },
  reason: SpacePasswordPromptReason
): boolean {
  const expectedStatus = reason === "required" ? 401 : 403;
  const hintRegex =
    reason === "required"
      ? SPACE_PASSWORD_REQUIRED_HINT_REGEX
      : SPACE_PASSWORD_INVALID_HINT_REGEX;
  if (parsed.status === expectedStatus && hintRegex.test(parsed.message)) {
    return true;
  }
  return (
    new RegExp(`\\bHTTP\\s+${expectedStatus}\\b`, "i").test(parsed.message) &&
    hintRegex.test(parsed.message)
  );
}

export async function promptSpacePassword(): Promise<string | null> {
  const password = await passwordPrompt({
    message: "Space password",
    mask: "•",
    clearOnError: true,
    validate: validateSpacePasswordInput,
  });
  if (isCancel(password) || typeof password !== "string") {
    cancel("Cancelled.");
    return null;
  }
  return normalizeSpacePasswordText(password);
}

export function emitSpacePasswordPromptNotice(input: {
  presenter: PasswordPromptPresenter;
  reason: SpacePasswordPromptReason;
  codePrefix: string;
  requiredText?: string;
  invalidText?: string;
}): void {
  input.presenter.line({
    code: `${input.codePrefix}.${input.reason}`,
    text:
      input.reason === "required"
        ? (input.requiredText ??
          "This space is protected. Enter password to continue.")
        : (input.invalidText ?? "Password did not match. Try again."),
  });
}

function normalizeSpacePasswordInput(value: unknown): string {
  return typeof value === "string" ? normalizeSpacePasswordText(value) : "";
}

export async function runSpaceReadWithPasswordRetry<T>(input: {
  initialPassword?: string;
  interactive: boolean;
  presenter: PasswordPromptPresenter;
  execute: (password?: string) => Promise<T>;
}): Promise<
  | {
      status: "completed";
      result: T;
      password?: string;
    }
  | { status: "cancelled" }
> {
  return await runSpacePasswordRetry({
    initialPassword: input.initialPassword,
    interactive: input.interactive,
    presenter: input.presenter,
    codePrefix: "space.read.password",
    execute: input.execute,
  });
}

export async function runSpaceWriteWithPasswordRetry<T>(input: {
  initialPassword?: string;
  interactive: boolean;
  presenter: PasswordPromptPresenter;
  requiredText?: string;
  invalidText?: string;
  execute: (password?: string) => Promise<T>;
}): Promise<
  | {
      status: "completed";
      result: T;
      password?: string;
    }
  | { status: "cancelled" }
> {
  return await runSpacePasswordRetry({
    initialPassword: input.initialPassword,
    interactive: input.interactive,
    presenter: input.presenter,
    codePrefix: "space.write.password",
    requiredText: input.requiredText,
    invalidText: input.invalidText,
    execute: input.execute,
  });
}

export async function runSpacePasswordRetry<T>(input: {
  initialPassword?: string;
  interactive: boolean;
  presenter: PasswordPromptPresenter;
  codePrefix: string;
  requiredText?: string;
  invalidText?: string;
  execute: (password?: string) => Promise<T>;
}): Promise<
  | {
      status: "completed";
      result: T;
      password?: string;
    }
  | { status: "cancelled" }
> {
  let nextPassword = input.initialPassword;

  for (;;) {
    try {
      const result = await input.execute(nextPassword);
      return {
        status: "completed",
        result,
        ...(nextPassword === undefined ? {} : { password: nextPassword }),
      };
    } catch (error) {
      const passwordPromptReason = input.interactive
        ? resolveSpacePasswordPromptReason(error)
        : null;
      if (!passwordPromptReason) {
        throw error;
      }
      emitSpacePasswordPromptNotice({
        presenter: input.presenter,
        reason: passwordPromptReason,
        codePrefix: input.codePrefix,
        requiredText: input.requiredText,
        invalidText: input.invalidText,
      });
      const promptedPassword = await promptSpacePassword();
      if (promptedPassword === null) {
        return { status: "cancelled" };
      }
      nextPassword = promptedPassword;
    }
  }
}

function parseHttpErrorMessage(error: unknown): {
  body: string;
  code: string;
  message: string;
  status: number;
} | null {
  const parsedFailure = parseHttpFailure(error);
  if (parsedFailure) {
    return {
      body: parsedFailure.body,
      code: parsedFailure.code,
      message: parsedFailure.message,
      status: parsedFailure.status,
    };
  }

  const message = toErrorMessage(error);
  const match = HTTP_ERROR_MESSAGE_REGEX.exec(message.trim());
  if (!match) {
    return null;
  }

  const status = Number.parseInt(match[1] ?? "", 10);
  if (!Number.isFinite(status)) {
    return null;
  }
  const body = match[2] ?? "";
  const payload = safeJsonParse(body);
  const code = readHttpErrorField(payload, "code");
  const errorMessage = readHttpErrorField(payload, "message");
  return {
    body,
    code,
    message: errorMessage,
    status,
  };
}

function readHttpErrorField(
  payload: unknown,
  field: "code" | "message"
): string {
  if (!payload || typeof payload !== "object") {
    return "";
  }
  const record = payload as {
    code?: unknown;
    message?: unknown;
    error?: { code?: unknown; message?: unknown } | null;
  };
  if (typeof record[field] === "string") {
    return record[field];
  }
  if (record.error && typeof record.error[field] === "string") {
    return record.error[field] ?? "";
  }
  return "";
}

function safeJsonParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
