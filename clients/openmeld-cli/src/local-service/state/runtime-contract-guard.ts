import {
  copyFile,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { daemonRuntimeRootPath } from "../../config/daemon-state";
import { formatOpenMeldCliTextBlock } from "../../runtime/cli-entry-command";
import {
  DAEMON_RUNTIME_CONTRACT_META_FILE,
  DAEMON_RUNTIME_CONTRACT_REPAIR_REPORT_FILE,
} from "../core/constants";
import {
  dirnamePath,
  normalizeOptionalText,
  toErrorMessage,
} from "../core/logger";
import type {
  DaemonRuntimeContractGuardResult,
  DaemonRuntimeContractMeta,
  DaemonRuntimeContractRepairReason,
  DaemonRuntimeContractRepairReport,
  DaemonRuntimePaths,
} from "../core/types";
import { DaemonServiceRunError } from "../core/types";
import { DAEMON_LOCAL_STATE_EPOCH } from "./local-state-version";

const RUNTIME_CONTRACT_META_SCHEMA = "daemon.runtime.contract.meta" as const;
const RUNTIME_CONTRACT_REPAIR_REPORT_SCHEMA =
  "daemon.runtime.contract.repair.report" as const;

type GuardInput = {
  runtimePaths: DaemonRuntimePaths;
  contractEpoch?: string;
  nowIso?: string;
};

type RepairRuntimeStateInput = {
  contractEpoch: string;
  fromEpoch: string | null;
  nowIso: string;
  reason: DaemonRuntimeContractRepairReason;
  runtimePaths: DaemonRuntimePaths;
  stateFilePaths: string[];
};

type ParsedMeta = {
  contractEpoch: string;
  updatedAt: string;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const createRuntimeContractMeta = (input: {
  contractEpoch: string;
  nowIso: string;
}): DaemonRuntimeContractMeta => ({
  schema: RUNTIME_CONTRACT_META_SCHEMA,
  v: 1,
  contractEpoch: input.contractEpoch,
  updatedAt: input.nowIso,
});

const createRuntimeContractRepairReport = (input: {
  appliedAt: string;
  backupPaths: string[];
  cleanedPaths: string[];
  errorMessage: string | null;
  fromEpoch: string | null;
  reason: DaemonRuntimeContractRepairReason;
  status: "applied" | "failed";
  toEpoch: string;
}): DaemonRuntimeContractRepairReport => ({
  schema: RUNTIME_CONTRACT_REPAIR_REPORT_SCHEMA,
  v: 1,
  status: input.status,
  reason: input.reason,
  fromEpoch: input.fromEpoch,
  toEpoch: input.toEpoch,
  appliedAt: input.appliedAt,
  cleanedPaths: [...input.cleanedPaths],
  backupPaths: [...input.backupPaths],
  errorMessage: input.errorMessage,
});

const parseRuntimeContractMeta = (
  value: unknown
): DaemonRuntimeContractMeta | null => {
  if (!isRecord(value)) {
    return null;
  }
  if (typeof value.v === "number" && value.v > 1) {
    throw new Error(
      "This OpenMeld version cannot read the newer local runtime state. Update OpenMeld to continue. Your local data has been preserved."
    );
  }
  if (value.schema !== RUNTIME_CONTRACT_META_SCHEMA || value.v !== 1) {
    return null;
  }
  const contractEpoch = normalizeOptionalText(value.contractEpoch);
  const updatedAt = normalizeOptionalText(value.updatedAt);
  if (!(contractEpoch && updatedAt)) {
    return null;
  }
  return {
    schema: RUNTIME_CONTRACT_META_SCHEMA,
    v: 1,
    contractEpoch,
    updatedAt,
  };
};

const parseRuntimeContractRepairReport = (
  value: unknown
): DaemonRuntimeContractRepairReport | null => {
  if (!isRecord(value)) {
    return null;
  }
  if (value.schema !== RUNTIME_CONTRACT_REPAIR_REPORT_SCHEMA || value.v !== 1) {
    return null;
  }
  const status = value.status;
  const reason = value.reason;
  const fromEpochRaw = value.fromEpoch;
  const toEpoch = normalizeOptionalText(value.toEpoch);
  const appliedAt = normalizeOptionalText(value.appliedAt);
  const cleanedPathsRaw = value.cleanedPaths;
  const backupPathsRaw = value.backupPaths;
  const errorMessageRaw = value.errorMessage;

  if (status !== "applied" && status !== "failed") {
    return null;
  }
  if (
    reason !== "legacy_state_without_meta" &&
    reason !== "contract_epoch_mismatch"
  ) {
    return null;
  }
  if (!(toEpoch && appliedAt)) {
    return null;
  }
  if (!(Array.isArray(cleanedPathsRaw) && Array.isArray(backupPathsRaw))) {
    return null;
  }

  const cleanedPaths = cleanedPathsRaw
    .map((item) => normalizeOptionalText(item))
    .filter((item): item is string => item !== null);
  const backupPaths = backupPathsRaw
    .map((item) => normalizeOptionalText(item))
    .filter((item): item is string => item !== null);

  const fromEpoch =
    fromEpochRaw === null ? null : normalizeOptionalText(fromEpochRaw);
  if (fromEpochRaw !== null && fromEpoch === null) {
    return null;
  }

  const errorMessage =
    errorMessageRaw === null ? null : normalizeOptionalText(errorMessageRaw);
  if (errorMessageRaw !== null && errorMessage === null) {
    return null;
  }

  return {
    schema: RUNTIME_CONTRACT_REPAIR_REPORT_SCHEMA,
    v: 1,
    status,
    reason,
    fromEpoch,
    toEpoch,
    appliedAt,
    cleanedPaths,
    backupPaths,
    errorMessage,
  };
};

const readParsedJsonFile = async <T>(input: {
  parse: (value: unknown) => T | null;
  path: string;
}): Promise<T | null> => {
  const raw = await readFile(input.path, "utf8").catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") {
        return null;
      }
      throw error;
    }
  );
  if (!raw) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  return input.parse(parsed);
};

const writeJsonAtomic = async (input: {
  path: string;
  value: unknown;
}): Promise<void> => {
  await mkdir(dirnamePath(input.path), { recursive: true });
  const tempPath = `${input.path}.tmp-${Date.now()}-${process.pid}`;
  await writeFile(
    tempPath,
    `${JSON.stringify(input.value, null, 2)}\n`,
    "utf8"
  );
  await rename(tempPath, input.path).catch(async (error) => {
    await rm(tempPath, { force: true }).catch(() => undefined);
    throw error;
  });
};

const fileExists = async (path: string): Promise<boolean> => {
  try {
    await readFile(path, "utf8");
    return true;
  } catch {
    return false;
  }
};

const getRuntimeStateFilePaths = (
  runtimePaths: DaemonRuntimePaths
): string[] => [
  runtimePaths.contextStorePath,
  join(runtimePaths.ledgerRootPath, "state.json"),
  join(runtimePaths.ledgerRootPath, "state.backup.json"),
  join(runtimePaths.ledgerRootPath, "state.tmp"),
  join(runtimePaths.ledgerRootPath, "history.tmp"),
];

const readMetaEpoch = async (
  contractMetaPath: string
): Promise<ParsedMeta | null> => {
  const parsed = await readParsedJsonFile({
    path: contractMetaPath,
    parse: parseRuntimeContractMeta,
  });
  if (!parsed) {
    return null;
  }
  return {
    contractEpoch: parsed.contractEpoch,
    updatedAt: parsed.updatedAt,
  };
};

export const readDaemonRuntimeContractMeta =
  async (): Promise<DaemonRuntimeContractMeta | null> => {
    const path = daemonRuntimeContractMetaPath();
    let raw: string;
    try {
      raw = await readFile(path, "utf8");
    } catch (error) {
      if (isFileNotFoundError(error)) {
        return null;
      }
      throw error;
    }
    if (!raw) {
      return null;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return null;
    }
    return parseRuntimeContractMeta(parsed);
  };

const isFileNotFoundError = (error: unknown): boolean =>
  Boolean(error && typeof error === "object" && "code" in error) &&
  (error as { code?: unknown }).code === "ENOENT";

const backupAndCleanRuntimeState = async (
  input: RepairRuntimeStateInput
): Promise<DaemonRuntimeContractGuardResult> => {
  const cleanedPaths: string[] = [];
  const backupPaths: string[] = [];
  const backupSuffix = `bak.${Date.now()}`;

  const writeRepairReport = async (
    report: DaemonRuntimeContractRepairReport
  ) => {
    await writeJsonAtomic({
      path: input.runtimePaths.contractRepairReportPath,
      value: report,
    });
  };

  try {
    for (const statePath of input.stateFilePaths) {
      const backupPath = `${statePath}.${backupSuffix}`;
      await copyFile(statePath, backupPath);
      backupPaths.push(backupPath);
      await rm(statePath, { force: true });
      cleanedPaths.push(statePath);
    }

    const nextMeta = createRuntimeContractMeta({
      contractEpoch: input.contractEpoch,
      nowIso: input.nowIso,
    });
    await writeJsonAtomic({
      path: input.runtimePaths.contractMetaPath,
      value: nextMeta,
    });

    const report = createRuntimeContractRepairReport({
      appliedAt: input.nowIso,
      backupPaths,
      cleanedPaths,
      errorMessage: null,
      fromEpoch: input.fromEpoch,
      reason: input.reason,
      status: "applied",
      toEpoch: input.contractEpoch,
    });
    await writeRepairReport(report);

    return {
      action: "repair_applied",
      reason: input.reason,
      meta: nextMeta,
      report,
    };
  } catch (error) {
    const failedReport = createRuntimeContractRepairReport({
      appliedAt: input.nowIso,
      backupPaths,
      cleanedPaths,
      errorMessage: toErrorMessage(error),
      fromEpoch: input.fromEpoch,
      reason: input.reason,
      status: "failed",
      toEpoch: input.contractEpoch,
    });
    await writeRepairReport(failedReport).catch(() => undefined);
    throw new DaemonServiceRunError({
      code: "daemon.runtime_state_repair_failed",
      message: formatOpenMeldCliTextBlock(
        "OpenMeld could not fix local runtime data automatically.\n" +
          "Please restart the service:\n" +
          "1) `openmeld service stop --force`\n" +
          "2) `openmeld service start`\n\n" +
          "If this still fails, repair the service:\n" +
          "1) `openmeld service repair`\n" +
          "2) `openmeld service start`"
      ),
    });
  }
};

export const ensureDaemonRuntimeContractState = async (
  input: GuardInput
): Promise<DaemonRuntimeContractGuardResult> => {
  const contractEpoch =
    normalizeOptionalText(input.contractEpoch) ?? DAEMON_LOCAL_STATE_EPOCH;
  const nowIso =
    normalizeOptionalText(input.nowIso) ?? new Date().toISOString();

  const stateFilePaths = getRuntimeStateFilePaths(input.runtimePaths);
  const existingStatePaths: string[] = [];
  for (const statePath of stateFilePaths) {
    if (await fileExists(statePath)) {
      existingStatePaths.push(statePath);
    }
  }

  const meta = await readMetaEpoch(input.runtimePaths.contractMetaPath);
  if (!meta) {
    if (existingStatePaths.length === 0) {
      const nextMeta = createRuntimeContractMeta({
        contractEpoch,
        nowIso,
      });
      await writeJsonAtomic({
        path: input.runtimePaths.contractMetaPath,
        value: nextMeta,
      });
      return {
        action: "fresh_init",
        meta: nextMeta,
      };
    }
    return await backupAndCleanRuntimeState({
      contractEpoch,
      fromEpoch: null,
      nowIso,
      reason: "legacy_state_without_meta",
      runtimePaths: input.runtimePaths,
      stateFilePaths: existingStatePaths,
    });
  }

  if (meta.contractEpoch !== contractEpoch) {
    return await backupAndCleanRuntimeState({
      contractEpoch,
      fromEpoch: meta.contractEpoch,
      nowIso,
      reason: "contract_epoch_mismatch",
      runtimePaths: input.runtimePaths,
      stateFilePaths: existingStatePaths,
    });
  }

  return {
    action: "none",
    meta: createRuntimeContractMeta({
      contractEpoch: meta.contractEpoch,
      nowIso: meta.updatedAt,
    }),
  };
};

export const daemonRuntimeContractRepairReportPath = (): string =>
  join(
    daemonRuntimeRootPath(),
    "data",
    DAEMON_RUNTIME_CONTRACT_REPAIR_REPORT_FILE
  );

export const daemonRuntimeContractMetaPath = (): string =>
  join(daemonRuntimeRootPath(), "data", DAEMON_RUNTIME_CONTRACT_META_FILE);

export const readDaemonRuntimeContractRepairReport =
  async (): Promise<DaemonRuntimeContractRepairReport | null> => {
    return await readParsedJsonFile({
      path: daemonRuntimeContractRepairReportPath(),
      parse: parseRuntimeContractRepairReport,
    });
  };
