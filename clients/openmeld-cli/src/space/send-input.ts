import { readFile } from "node:fs/promises";
import {
  createSpaceSendInputConflictGuideError,
  createSpaceSendInputEmptyGuideError,
  createSpaceSendInputFileReadFailedGuideError,
  createSpaceSendInputRequiredGuideError,
} from "../runtime/dual-view-guide-catalog";

type ResolveSpaceSendTextInput = {
  allowEmpty?: boolean;
  text?: string;
  stdin?: boolean;
  file?: string;
  readFromStdin?: () => Promise<string>;
  readFromFile?: (path: string) => Promise<string>;
};

export async function resolveSpaceSendText(
  input: ResolveSpaceSendTextInput
): Promise<string> {
  const textValue = String(input.text ?? "");
  const stdinEnabled = input.stdin === true;
  const filePath = String(input.file ?? "").trim();

  const hasTextSource = textValue.length > 0;
  const hasFileSource = filePath.length > 0;
  const sourceCount =
    Number(hasTextSource) + Number(stdinEnabled) + Number(hasFileSource);

  if (sourceCount === 0) {
    if (input.allowEmpty) {
      return "";
    }
    throw createSpaceSendInputRequiredGuideError();
  }
  if (sourceCount > 1) {
    throw createSpaceSendInputConflictGuideError();
  }

  let resolvedText = textValue;
  if (hasFileSource) {
    const readFromFile = input.readFromFile ?? readSpaceSendFile;
    try {
      resolvedText = await readFromFile(filePath);
    } catch (error) {
      throw createSpaceSendInputFileReadFailedGuideError(
        filePath,
        toErrorMessage(error)
      );
    }
  }
  if (stdinEnabled) {
    const readFromStdin = input.readFromStdin ?? readSpaceSendStdin;
    resolvedText = await readFromStdin();
  }

  if (resolvedText.trim().length === 0 && !input.allowEmpty) {
    throw createSpaceSendInputEmptyGuideError();
  }

  return resolvedText;
}

function readSpaceSendFile(path: string): Promise<string> {
  return readFile(path, "utf8");
}

function readSpaceSendStdin(): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const chunks: string[] = [];

    const cleanup = () => {
      process.stdin.off("data", onData);
      process.stdin.off("end", onEnd);
      process.stdin.off("error", onError);
    };

    const onData = (chunk: string | Buffer) => {
      if (typeof chunk === "string") {
        chunks.push(chunk);
        return;
      }
      chunks.push(chunk.toString("utf8"));
    };

    const onEnd = () => {
      cleanup();
      resolve(chunks.join(""));
    };

    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };

    process.stdin.setEncoding("utf8");
    process.stdin.on("data", onData);
    process.stdin.on("end", onEnd);
    process.stdin.on("error", onError);
    process.stdin.resume();
  });
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  return String(error ?? "unknown error");
}
