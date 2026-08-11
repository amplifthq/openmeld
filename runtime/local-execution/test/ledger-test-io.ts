import {
  appendFile,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { LedgerFileIo, LedgerPaths } from "../src/ledger-store";

export const createNodeLedgerFileIo = (): LedgerFileIo => ({
  appendFile,
  copyFile,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
});

export const createTempLedgerPaths = async (
  prefix: string
): Promise<LedgerPaths> => {
  const rootDirPath = await mkdtemp(path.join(os.tmpdir(), prefix));
  const stateFilePath = path.join(rootDirPath, "state.v1.json");
  return {
    backupStateFilePath: `${stateFilePath}.bak`,
    historyFilePath: path.join(rootDirPath, "history.ndjson"),
    historyTempFilePath: path.join(
      rootDirPath,
      `history.ndjson.tmp-${process.pid}-${Date.now()}`
    ),
    rootDirPath,
    stateFilePath,
    stateTempFilePath: path.join(
      rootDirPath,
      `state.v1.json.tmp-${process.pid}-${Date.now()}`
    ),
  };
};
