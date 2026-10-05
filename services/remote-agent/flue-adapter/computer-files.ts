import { posix } from "node:path";
import type { WorkspaceClient } from "@cloudflare/computer";
import type { CloudComputerOperation } from "@openmeld/schemas";

export function resolveComputerPath(path: string, cwd = "/computer/home") {
  const resolved = posix.resolve(cwd, path);
  if (resolved !== "/computer" && !resolved.startsWith("/computer/")) {
    throw new Error("computer.path_outside_workspace");
  }
  return resolved;
}

/** Serializes short controlled mutations, never commands or whole tasks. */
export class ComputerFiles {
  private tail: Promise<unknown> = Promise.resolve();

  private readonly fs: WorkspaceClient["fs"];

  constructor(fs: WorkspaceClient["fs"]) {
    this.fs = fs;
  }

  async write(path: string, content: string | Uint8Array): Promise<void> {
    await this.mutate(async () => {
      const resolved = resolveComputerPath(path);
      await this.fs.mkdir(posix.dirname(resolved), { recursive: true });
      await this.fs.writeFile(resolved, content);
    });
  }

  async execute(
    request: Exclude<CloudComputerOperation, { action: "command" }>
  ) {
    const path = resolveComputerPath(request.path);
    if (request.action === "read") {
      const stat = await this.fs.stat(path);
      if (stat.size > 2_000_000) {
        throw new Error("computer.file_too_large");
      }
      return { path, content: await this.fs.readFile(path, "utf8") };
    }
    if (request.action === "list") {
      return {
        path,
        entries: (await this.fs.readdir(path)).map((entry) => entry.name),
      };
    }
    return await this.mutate(async () => {
      if (request.action === "write") {
        if (
          request.expectedContent !== undefined &&
          (await this.fs.readFile(path, "utf8")) !== request.expectedContent
        ) {
          throw new Error(
            "computer.file_changed: Read the current file before editing it."
          );
        }
        await this.fs.mkdir(posix.dirname(path), { recursive: true });
        await this.fs.writeFile(path, request.content);
        return { path, written: true };
      }
      const content = await this.fs.readFile(path, "utf8");
      const occurrences = content.split(request.oldText).length - 1;
      if (!occurrences || (!request.replaceAll && occurrences !== 1)) {
        throw new Error(
          "computer.edit_conflict: Read the current file and provide unique text to replace."
        );
      }
      await this.fs.writeFile(
        path,
        request.replaceAll
          ? content.replaceAll(request.oldText, () => request.newText)
          : content.replace(request.oldText, () => request.newText)
      );
      return { path, replacements: request.replaceAll ? occurrences : 1 };
    });
  }

  private async mutate<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.tail.then(operation);
    this.tail = result.catch(() => undefined);
    return await result;
  }
}
