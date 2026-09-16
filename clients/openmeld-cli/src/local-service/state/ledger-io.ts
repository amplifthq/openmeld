import {
  appendFile,
  copyFile,
  mkdir,
  open,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { dirnamePath } from "../core/logger";

export function createLedgerIo() {
  return {
    appendFile: async (
      filePath: string,
      content: string,
      encoding: "utf8"
    ): Promise<void> => {
      await mkdir(dirnamePath(filePath), {
        recursive: true,
      });
      await appendFile(filePath, content, {
        encoding,
      });
    },
    copyFile: async (fromPath: string, toPath: string): Promise<void> => {
      await mkdir(dirnamePath(toPath), {
        recursive: true,
      });
      await copyFile(fromPath, toPath);
    },
    mkdir: async (
      dirPath: string,
      options: {
        recursive: boolean;
      }
    ): Promise<void> => {
      await mkdir(dirPath, options);
    },
    readFile: async (filePath: string, encoding: "utf8"): Promise<string> => {
      return await readFile(filePath, encoding);
    },
    rename: async (fromPath: string, toPath: string): Promise<void> => {
      await mkdir(dirnamePath(toPath), {
        recursive: true,
      });
      await rename(fromPath, toPath);
    },
    syncPath: async (fileOrDirectoryPath: string): Promise<void> => {
      const isWindows = process.platform === "win32";
      if (isWindows && (await stat(fileOrDirectoryPath)).isDirectory()) {
        // Node does not provide a supported Windows directory flush. File
        // flushes and atomic rename remain required, but power-loss durability
        // of directory entries is not guaranteed on this platform.
        return;
      }
      // Windows FlushFileBuffers requires a handle opened with write access.
      const handle = await open(fileOrDirectoryPath, isWindows ? "r+" : "r");
      try {
        await handle.sync();
      } finally {
        await handle.close();
      }
    },
    rm: async (
      filePath: string,
      options: {
        force: boolean;
      }
    ): Promise<void> => {
      await rm(filePath, options);
    },
    writeFile: async (
      filePath: string,
      content: string,
      encoding: "utf8"
    ): Promise<void> => {
      await mkdir(dirnamePath(filePath), {
        recursive: true,
      });
      await writeFile(filePath, content, encoding);
    },
  } as const;
}
