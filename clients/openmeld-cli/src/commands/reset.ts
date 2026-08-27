import { realpathSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
} from "node:path";
import { cancel, confirm, isCancel, text } from "@clack/prompts";
import {
  formatLaneScopeSentence,
  resolveOpenMeldLaneDescriptor,
} from "../config/openmeld-lane-descriptor";
import { openMeldRootDir } from "../config/paths";
import { resolveRuntimeContext } from "../runtime/context";
import { createResetConfirmationGuideError } from "../runtime/dual-view-guide-catalog";
import { canUseInteractivePrompts } from "../runtime/interaction";
import { createPresenter } from "../runtime/presenter/index";
import { OPENMELD_VERSION } from "../runtime/version";
import { bootstrapOpenMeldHome } from "../system/bootstrap";
import { runDaemonTeardownStrict } from "./service";
import { runSkillsCheck } from "./skills";
import { emitTopLevelAgentOverview } from "./top-level-agent-overview";

const RESET_CONFIRM_TOKEN = "reset";
const OPENMELD_ROOT_BASENAME_REGEX = /^\.?openmeld(?:[-_.].*)?$/i;
const RESET_ALLOW_UNSAFE_HOME_ENV = "OPENMELD_RESET_ALLOW_UNSAFE_HOME";

export async function runReset(input: {
  view?: string;
  yes?: boolean;
}): Promise<{ reset: boolean }> {
  const runtime = await resolveRuntimeContext({
    view: input.view,
  });
  const presenter = createPresenter(runtime);
  if (runtime.resolvedView === "agent") {
    emitTopLevelAgentOverview({
      presenter,
      command: "reset",
    });
  }
  const allowPrompt = canUseInteractivePrompts(runtime);
  const rootDir = openMeldRootDir();
  const lane = resolveOpenMeldLaneDescriptor();

  const skipConfirmation = Boolean(input.yes);
  if (!skipConfirmation) {
    if (!allowPrompt) {
      if (runtime.resolvedView === "agent") {
        throw createResetConfirmationGuideError();
      }
      throw new Error(
        "openmeld reset requires --yes in non-interactive mode\nexample: openmeld reset --yes"
      );
    }

    const first = await confirm({
      message: `Reset local OpenMeld state at "${rootDir}"?`,
      initialValue: false,
    });
    if (isCancel(first) || !first) {
      cancel("Cancelled.");
      return { reset: false };
    }

    const second = await text({
      message: 'Type "RESET" to confirm destructive reset (case-insensitive)',
      placeholder: "RESET",
    });
    if (
      isCancel(second) ||
      normalizeResetConfirm(second) !== RESET_CONFIRM_TOKEN
    ) {
      cancel("Cancelled.");
      return { reset: false };
    }
  }

  // False-positive guard: keep the safety assertion before backup/reset operations.
  assertSafeOpenMeldRoot(rootDir);
  await runDaemonTeardownStrict({
    reason: "reset",
  });
  await rm(rootDir, { recursive: true, force: true });
  const bootstrap = await bootstrapOpenMeldHome({
    currentVersion: OPENMELD_VERSION,
  });
  await runSkillsCheck({
    view: runtime.resolvedView,
    quiet: true,
    suppressAgentOverview: true,
  });
  const payload = {
    lane,
    rootDir,
    version: bootstrap.versionState.last_version ?? OPENMELD_VERSION,
    skills: bootstrap.skills.map((skill) => ({
      id: skill.id,
      path: skill.relativePath,
    })),
  };
  if (runtime.resolvedView === "agent") {
    presenter.data({
      code: "reset.completed",
      payload,
    });
  } else {
    presenter.line({
      code: "reset.completed",
      text: `OpenMeld reset completed at ${payload.rootDir} (version ${payload.version}). ${formatLaneScopeSentence(lane)}`,
    });
  }

  return { reset: true };
}

function normalizeResetConfirm(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

function assertSafeOpenMeldRoot(rootDir: string): void {
  const normalized = rootDir.trim();
  if (!normalized || normalized === "/" || normalized.length < 4) {
    throw new Error(`unsafe OpenMeld root path for reset: ${rootDir}`);
  }

  const base = basename(normalized);
  if (OPENMELD_ROOT_BASENAME_REGEX.test(base)) {
    return;
  }

  const allowUnsafeHome = process.env[RESET_ALLOW_UNSAFE_HOME_ENV] === "1";
  if (!allowUnsafeHome) {
    throw new Error(`unsafe OpenMeld root path for reset: ${rootDir}`);
  }

  const tempRoot = tmpdir();
  if (!isPathInsideRoot({ rootDir: tempRoot, candidatePath: normalized })) {
    throw new Error(
      `unsafe OpenMeld root path for reset: ${rootDir}; ${RESET_ALLOW_UNSAFE_HOME_ENV}=1 only allows temp directories under ${tempRoot}`
    );
  }
}

function isPathInsideRoot(input: {
  rootDir: string;
  candidatePath: string;
}): boolean {
  const rootDir = resolvePathForSafetyCheck(input.rootDir);
  const candidatePath = resolvePathForSafetyCheck(input.candidatePath);
  const relativePath = relative(rootDir, candidatePath);
  if (relativePath.length === 0) {
    return true;
  }
  if (relativePath.startsWith("..")) {
    return false;
  }
  return !isAbsolute(relativePath);
}

function resolvePathForSafetyCheck(path: string): string {
  const resolved = resolve(path);
  const direct = resolveRealPathOrNull(resolved);
  if (direct) {
    return direct;
  }

  // Resolve nearest existing ancestor to avoid symlink-bypass via a missing leaf.
  let cursor = resolved;
  const missingSegments: string[] = [];
  while (true) {
    const existing = resolveRealPathOrNull(cursor);
    if (existing) {
      return missingSegments.length === 0
        ? existing
        : join(existing, ...missingSegments.reverse());
    }
    const parent = dirname(cursor);
    if (parent === cursor) {
      return resolved;
    }
    missingSegments.push(basename(cursor));
    cursor = parent;
  }
}

function resolveRealPathOrNull(path: string): string | null {
  try {
    return realpathSync(path);
  } catch {
    return null;
  }
}
