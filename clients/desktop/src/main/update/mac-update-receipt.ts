import {
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename } from "node:path";

const MAX_RECEIPT_BYTES = 2048;
const RECEIPT_VALUE = /^[^\r\n]{1,200}$/u;
const RECEIPT_KEYS = [
  "state",
  "sourceVersion",
  "targetVersion",
  "sourceBundle",
  "targetBundle",
] as const;

export type MacUpdateInstallReceipt = {
  state: string;
  sourceVersion: string;
  targetVersion: string;
  sourceBundle: string;
  targetBundle: string;
};

type ReceiptDeps = {
  readFile: typeof readFileSync;
  rename: typeof renameSync;
  stat: typeof statSync;
  writeFile: typeof writeFileSync;
};

const DEFAULT_DEPS: ReceiptDeps = {
  readFile: readFileSync,
  rename: renameSync,
  stat: statSync,
  writeFile: writeFileSync,
};

export function parseMacUpdateInstallReceipt(
  content: string
): MacUpdateInstallReceipt {
  if (Buffer.byteLength(content, "utf8") > MAX_RECEIPT_BYTES) {
    throw new Error("Desktop update install receipt is too large.");
  }
  const values = new Map<string, string>();
  for (const line of content.split("\n")) {
    if (!line) {
      continue;
    }
    const separator = line.indexOf("=");
    if (separator <= 0) {
      throw new Error("Desktop update install receipt is malformed.");
    }
    const key = line.slice(0, separator);
    const value = line.slice(separator + 1);
    if (
      !(RECEIPT_KEYS as readonly string[]).includes(key) ||
      values.has(key) ||
      !RECEIPT_VALUE.test(value)
    ) {
      throw new Error("Desktop update install receipt is malformed.");
    }
    values.set(key, value);
  }
  for (const key of RECEIPT_KEYS) {
    if (!values.has(key)) {
      throw new Error("Desktop update install receipt is incomplete.");
    }
  }
  return {
    state: values.get("state")!,
    sourceVersion: values.get("sourceVersion")!,
    targetVersion: values.get("targetVersion")!,
    sourceBundle: values.get("sourceBundle")!,
    targetBundle: values.get("targetBundle")!,
  };
}

export function readMacUpdateInstallReceipt(
  receiptPath: string,
  deps: ReceiptDeps = DEFAULT_DEPS
): MacUpdateInstallReceipt | null {
  try {
    if (deps.stat(receiptPath).size > MAX_RECEIPT_BYTES) {
      throw new Error("Desktop update install receipt is too large.");
    }
    return parseMacUpdateInstallReceipt(deps.readFile(receiptPath, "utf8"));
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return null;
    }
    throw error;
  }
}

export function confirmMacUpdateInstallReceipt(
  input: {
    receiptPath: string;
    currentVersion: string;
    currentBundle: string | null;
  },
  deps: ReceiptDeps = DEFAULT_DEPS
): MacUpdateInstallReceipt | null {
  const receipt = readMacUpdateInstallReceipt(input.receiptPath, deps);
  if (!receipt) {
    return null;
  }
  if (
    receipt.state !== "launch_confirmed" ||
    receipt.targetVersion !== input.currentVersion ||
    !input.currentBundle ||
    receipt.targetBundle !== basename(input.currentBundle)
  ) {
    return receipt;
  }
  const confirmed = { ...receipt, state: "application_started" };
  const tempPath = `${input.receiptPath}.tmp-${process.pid}`;
  deps.writeFile(
    tempPath,
    [
      `state=${confirmed.state}`,
      `sourceVersion=${confirmed.sourceVersion}`,
      `targetVersion=${confirmed.targetVersion}`,
      `sourceBundle=${confirmed.sourceBundle}`,
      `targetBundle=${confirmed.targetBundle}`,
      "",
    ].join("\n"),
    { encoding: "utf8", mode: 0o600 }
  );
  deps.rename(tempPath, input.receiptPath);
  return confirmed;
}
