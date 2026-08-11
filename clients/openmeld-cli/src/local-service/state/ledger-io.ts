import {
  appendFile,
  mkdir,
  readFile,
  rename,
  rm,
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
      const raw = await readFile(fromPath, "utf8");
      await mkdir(dirnamePath(toPath), {
        recursive: true,
      });
      await writeFile(toPath, raw, "utf8");
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
