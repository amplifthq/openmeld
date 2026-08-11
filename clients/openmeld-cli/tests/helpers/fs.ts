import { chmod, lstat, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stripVTControlCharacters } from "node:util";
import { CLI_CONTEXT_ENV_KEYS } from "../../src/config/session-profile";

const SESSION_ENV_KEYS = [...CLI_CONTEXT_ENV_KEYS, "OPENMELD_PROFILE"] as const;

const AUTH_STORAGE_ENV_KEYS = [
  "OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN",
  "OPENMELD_AUTH_ALLOW_INSECURE_FILE_TOKEN",
  "OPENMELD_ENV_PRESET",
  "OPENMELD_USER_FACING_CLI_COMMAND",
  "OPENMELD_DEV_MODE",
] as const;

export async function withTempHome<T>(fn: (home: string) => Promise<T>) {
  const dir = await mkdtemp(join(tmpdir(), "openmeld-cli-test-"));
  const prevHome = process.env.HOME;
  const prevOpenMeldHome = process.env.OPENMELD_HOME;
  const prevSessionEnv = Object.fromEntries(
    SESSION_ENV_KEYS.map((key) => [key, process.env[key]])
  ) as Record<(typeof SESSION_ENV_KEYS)[number], string | undefined>;
  const prevAuthStorageEnv = Object.fromEntries(
    AUTH_STORAGE_ENV_KEYS.map((key) => [key, process.env[key]])
  ) as Record<(typeof AUTH_STORAGE_ENV_KEYS)[number], string | undefined>;
  process.env.HOME = dir;
  process.env.OPENMELD_HOME = join(dir, ".openmeld");
  for (const key of SESSION_ENV_KEYS) {
    delete process.env[key];
  }
  try {
    return await fn(dir);
  } finally {
    if (prevHome === undefined) {
      Reflect.deleteProperty(process.env, "HOME");
    } else {
      process.env.HOME = prevHome;
    }
    if (prevOpenMeldHome === undefined) {
      Reflect.deleteProperty(process.env, "OPENMELD_HOME");
    } else {
      process.env.OPENMELD_HOME = prevOpenMeldHome;
    }
    for (const key of SESSION_ENV_KEYS) {
      const value = prevSessionEnv[key];
      if (value === undefined) {
        delete process.env[key];
        continue;
      }
      process.env[key] = value;
    }
    for (const key of AUTH_STORAGE_ENV_KEYS) {
      const value = prevAuthStorageEnv[key];
      if (value === undefined) {
        delete process.env[key];
        continue;
      }
      process.env[key] = value;
    }
    await makeTreeWritableForRemoval(dir);
    await rm(dir, { recursive: true, force: true });
  }
}

async function makeTreeWritableForRemoval(path: string): Promise<void> {
  const entry = await lstat(path).catch(() => null);
  if (!entry) {
    return;
  }
  if (!entry.isDirectory()) {
    if (!entry.isSymbolicLink()) {
      await chmod(path, 0o600);
    }
    return;
  }

  await chmod(path, 0o700);
  const children = await readdir(path);
  await Promise.all(
    children.map((child) => makeTreeWritableForRemoval(join(path, child)))
  );
}

export async function withSilencedStdio<T>(fn: () => Promise<T>): Promise<T> {
  const stdoutWrite = process.stdout.write.bind(process.stdout);
  const stderrWrite = process.stderr.write.bind(process.stderr);
  process.stdout.write = () => true;
  process.stderr.write = () => true;
  try {
    return await fn();
  } finally {
    process.stdout.write = stdoutWrite;
    process.stderr.write = stderrWrite;
  }
}

export async function withCapturedStdio<T>(
  fn: () => Promise<T>,
  observer: {
    onStdout?: (text: string) => void;
    onStderr?: (text: string) => void;
  } = {}
): Promise<{
  result: T;
  stdout: string;
  stderr: string;
  plainStdout: string;
  plainStderr: string;
}> {
  const stdoutWrite = process.stdout.write.bind(process.stdout);
  const stderrWrite = process.stderr.write.bind(process.stderr);
  let stdout = "";
  let stderr = "";

  const createCapturedWrite = (append: (text: string) => void) =>
    ((
      chunk: unknown,
      encodingOrCallback?: BufferEncoding | ((error?: Error | null) => void),
      callback?: (error?: Error | null) => void
    ) => {
      const resolvedEncoding =
        typeof encodingOrCallback === "string" ? encodingOrCallback : undefined;
      const resolvedCallback =
        typeof encodingOrCallback === "function"
          ? encodingOrCallback
          : callback;

      if (typeof chunk === "string") {
        append(chunk);
      } else if (chunk instanceof Uint8Array) {
        append(Buffer.from(chunk).toString(resolvedEncoding));
      } else {
        append(String(chunk));
      }

      resolvedCallback?.(null);
      return true;
    }) as typeof process.stdout.write;

  process.stdout.write = createCapturedWrite((text) => {
    stdout += text;
    observer.onStdout?.(text);
  });

  process.stderr.write = createCapturedWrite((text) => {
    stderr += text;
    observer.onStderr?.(text);
  });

  try {
    const result = await fn();
    return {
      result,
      stdout,
      stderr,
      plainStdout: stripTerminalOutput(stdout),
      plainStderr: stripTerminalOutput(stderr),
    };
  } finally {
    process.stdout.write = stdoutWrite;
    process.stderr.write = stderrWrite;
  }
}

export function stripTerminalOutput(value: string | null | undefined): string {
  return stripVTControlCharacters(value ?? "").replaceAll("\r", "");
}
