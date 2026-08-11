import {
  createSandboxSessionEnv,
  type FileStat,
  type SandboxApi,
  type SandboxFactory,
  SandboxOperationUnsupportedError,
  type SessionEnv,
  type ShellResult,
} from "@flue/runtime";

const LEADING_SLASH_PATTERN = /^\//u;

export function disabledNoNetworkSandbox(): SandboxFactory {
  return {
    createSessionEnv(): Promise<SessionEnv> {
      return Promise.resolve(
        createSandboxSessionEnv(new DisabledNoNetworkSandboxApi(), "/")
      );
    },
    tools: () => [],
  };
}

class DisabledNoNetworkSandboxApi implements SandboxApi {
  private readonly files = new Map<string, Uint8Array>();

  async readFile(path: string): Promise<string> {
    return new TextDecoder().decode(await this.readFileBuffer(path));
  }

  readFileBuffer(path: string): Promise<Uint8Array> {
    const normalized = normalizePath(path);
    const value = this.files.get(normalized);
    if (!value) {
      return Promise.reject(new Error(`File not found: ${normalized}`));
    }
    return Promise.resolve(value);
  }

  writeFile(path: string, content: string | Uint8Array): Promise<void> {
    const bytes =
      typeof content === "string" ? new TextEncoder().encode(content) : content;
    this.files.set(normalizePath(path), bytes);
    return Promise.resolve();
  }

  stat(path: string): Promise<FileStat> {
    const normalized = normalizePath(path);
    if (this.files.has(normalized)) {
      return Promise.resolve({
        isDirectory: false,
        isFile: true,
        size: this.files.get(normalized)?.byteLength,
      });
    }
    return Promise.resolve({ isDirectory: true, isFile: false });
  }

  readdir(): Promise<string[]> {
    return Promise.resolve(
      [...this.files.keys()].map((path) =>
        path.replace(LEADING_SLASH_PATTERN, "")
      )
    );
  }

  exists(path: string): Promise<boolean> {
    return Promise.resolve(this.files.has(normalizePath(path)));
  }

  mkdir(): Promise<void> {
    return Promise.resolve();
  }

  rm(path: string): Promise<void> {
    this.files.delete(normalizePath(path));
    return Promise.resolve();
  }

  exec(): Promise<ShellResult> {
    return Promise.reject(
      new SandboxOperationUnsupportedError({
        operation: "exec",
        options: ["network", "shell"],
        provider: "openmeld-disabled-no-network",
      })
    );
  }
}

function normalizePath(path: string): string {
  return path.startsWith("/") ? path : `/${path}`;
}
