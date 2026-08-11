import { appendFile, mkdir, readFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import {
  acquireLock,
  isOpenMeldLockError,
  isOpenMeldOrphanedLockError,
  runWithHeldLock,
} from "../config/lock";
import {
  OPENMELD_HOME_ENV_KEY,
  resolveOpenMeldEnvPreset,
} from "../config/paths";

const POSIX_PATH_LINE =
  'export PATH="$HOME/.openmeld/bin:$PATH" # OpenMeld CLI';
const FISH_PATH_LINE =
  'fish_add_path --prepend --global "$HOME/.openmeld/bin" # OpenMeld CLI';
const NEWLINE_SPLIT_PATTERN = /\r?\n/u;
const COMMAND_ACTIVATION_LOCK_PROFILE = "managed-cli";
const COMMAND_ACTIVATION_LOCK_KEY = "command-activation";
const COMMAND_ACTIVATION_LOCK_RETRY_DELAY_MS = 50;
const COMMAND_ACTIVATION_LOCK_TIMEOUT_MS = 5000;

export type ManagedCliCommandActivation =
  | {
      status: "activated" | "already_active";
      profilePath: string;
    }
  | {
      status: "not_applicable";
    }
  | {
      status: "unsupported_shell";
      shell: string | null;
    };

export function getManagedCliCommandActivationNotice(
  activation: ManagedCliCommandActivation
): string | null {
  return activation.status === "activated"
    ? "OpenMeld added the openmeld command for future Terminal windows. This setup will keep running here; open a new Terminal window for later openmeld commands."
    : null;
}

export async function activateManagedCliCommand(input: {
  env?: NodeJS.ProcessEnv;
}): Promise<ManagedCliCommandActivation> {
  const env = input.env ?? process.env;
  if (
    resolveOpenMeldEnvPreset({ env }) !== "prod" ||
    normalizeOptionalText(env[OPENMELD_HOME_ENV_KEY])
  ) {
    return { status: "not_applicable" };
  }

  const home = normalizeOptionalText(env.HOME);
  if (!home) {
    return {
      shell: normalizeOptionalText(env.SHELL),
      status: "unsupported_shell",
    };
  }

  const shell = normalizeOptionalText(env.SHELL);
  const profile = resolveShellProfile({ env, home, shell });
  if (!profile) {
    return { shell, status: "unsupported_shell" };
  }

  return await withManagedCliCommandActivationLock({
    env,
    run: async () => {
      const existing = await readFile(profile.path, "utf8").catch((error) => {
        if (isErrorWithCode(error, "ENOENT")) {
          return "";
        }
        throw error;
      });
      if (existing.split(NEWLINE_SPLIT_PATTERN).includes(profile.pathLine)) {
        return { profilePath: profile.path, status: "already_active" };
      }

      await mkdir(dirname(profile.path), { recursive: true });
      const separator =
        existing.length === 0 || existing.endsWith("\n") ? "" : "\n";
      await appendFile(profile.path, `${separator}${profile.pathLine}\n`, {
        encoding: "utf8",
        mode: 0o600,
      });
      return { profilePath: profile.path, status: "activated" };
    },
  });
}

async function withManagedCliCommandActivationLock<T>(input: {
  env: NodeJS.ProcessEnv;
  run: () => Promise<T>;
}): Promise<T> {
  const startedAtMs = Date.now();

  for (;;) {
    try {
      const lock = await acquireLock({
        openMeldProfileId: COMMAND_ACTIVATION_LOCK_PROFILE,
        key: COMMAND_ACTIVATION_LOCK_KEY,
        meta: { component: "managed_cli.command_activation" },
        pathResolution: { env: input.env },
      });
      return await runWithHeldLock({
        lock,
        run: input.run,
        releaseContext: {
          component: "managed_cli.command_activation",
          lockKey: COMMAND_ACTIVATION_LOCK_KEY,
          openMeldProfileId: COMMAND_ACTIVATION_LOCK_PROFILE,
        },
      });
    } catch (error) {
      if (
        !isOpenMeldLockError(error) ||
        isOpenMeldOrphanedLockError(error) ||
        Date.now() - startedAtMs >= COMMAND_ACTIVATION_LOCK_TIMEOUT_MS
      ) {
        throw error;
      }
      await delay(COMMAND_ACTIVATION_LOCK_RETRY_DELAY_MS);
    }
  }
}

function resolveShellProfile(input: {
  env: NodeJS.ProcessEnv;
  home: string;
  shell: string | null;
}): { path: string; pathLine: string } | null {
  const shellName = input.shell ? basename(input.shell) : null;
  if (shellName === "zsh") {
    const zDotDir = normalizeOptionalText(input.env.ZDOTDIR);
    if (zDotDir && !isAbsolute(zDotDir)) {
      return null;
    }
    return {
      path: join(zDotDir ?? input.home, ".zshrc"),
      pathLine: POSIX_PATH_LINE,
    };
  }
  if (shellName === "bash") {
    return {
      path: join(input.home, ".bash_profile"),
      pathLine: POSIX_PATH_LINE,
    };
  }
  if (shellName === "fish") {
    const configHome = normalizeOptionalText(input.env.XDG_CONFIG_HOME);
    if (configHome && !isAbsolute(configHome)) {
      return null;
    }
    return {
      path: join(
        configHome ?? join(input.home, ".config"),
        "fish",
        "conf.d",
        "openmeld.fish"
      ),
      pathLine: FISH_PATH_LINE,
    };
  }
  return null;
}

function normalizeOptionalText(value: unknown): string | null {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}

function isErrorWithCode(error: unknown, code: string): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === code
  );
}
