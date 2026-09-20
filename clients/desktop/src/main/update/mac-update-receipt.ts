import { Buffer } from "node:buffer";
import {
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename } from "node:path";
import { MAC_PRODUCTION_APP_BUNDLE_NAME } from "./mac-bundle-path";

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

function serializeReceipt(receipt: MacUpdateInstallReceipt): string {
  return [
    `state=${receipt.state}`,
    `sourceVersion=${receipt.sourceVersion}`,
    `targetVersion=${receipt.targetVersion}`,
    `sourceBundle=${receipt.sourceBundle}`,
    `targetBundle=${receipt.targetBundle}`,
    "",
  ].join("\n");
}

function writeReceipt(
  receiptPath: string,
  receipt: MacUpdateInstallReceipt,
  deps: ReceiptDeps
): void {
  const tempPath = `${receiptPath}.tmp-${process.pid}`;
  deps.writeFile(tempPath, serializeReceipt(receipt), {
    encoding: "utf8",
    mode: 0o600,
  });
  deps.rename(tempPath, receiptPath);
}

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

export function recordMacUpdateInstallRequested(
  input: {
    receiptPath: string;
    currentVersion: string;
    targetVersion: string;
    currentBundle: string;
  },
  deps: ReceiptDeps = DEFAULT_DEPS
): MacUpdateInstallReceipt {
  const sourceBundle = basename(input.currentBundle);
  if (sourceBundle !== MAC_PRODUCTION_APP_BUNDLE_NAME) {
    throw new Error(
      "Desktop cannot record a macOS update from an unexpected app folder."
    );
  }
  const receipt: MacUpdateInstallReceipt = {
    state: "install_requested",
    sourceVersion: input.currentVersion,
    targetVersion: input.targetVersion,
    sourceBundle,
    targetBundle: MAC_PRODUCTION_APP_BUNDLE_NAME,
  };
  writeReceipt(input.receiptPath, receipt, deps);
  return receipt;
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
    receipt.state !== "install_requested" ||
    receipt.targetVersion !== input.currentVersion ||
    !input.currentBundle ||
    receipt.targetBundle !== basename(input.currentBundle)
  ) {
    return receipt;
  }
  const confirmed = { ...receipt, state: "application_started" };
  writeReceipt(input.receiptPath, confirmed, deps);
  return confirmed;
}
