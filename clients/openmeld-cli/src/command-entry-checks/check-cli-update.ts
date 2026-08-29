import { cancel, confirm, isCancel } from "@clack/prompts";
import { runUpgrade } from "../commands/upgrade";
import { ensureVersionStateReady } from "../config/version-state";
import { formatOpenMeldCliCommands } from "../runtime/cli-entry-command";
import { readDispatchOwnedRuntimeGuard } from "../runtime/dispatch-owned-runtime";
import { buildAgentCheckResult } from "./build-agent-check-result";
import {
  assessCliUpdate,
  type CliUpdateAssessment,
  isCliUpdateCheckApplicable,
} from "./cli-update-assessment";
import { getCommandEntryCopy } from "./command-entry-copy";
import {
  buildBlockedEntryCheckResult,
  ENTRY_CHECK_BLOCKED_ERROR_CODES,
} from "./entry-check-blocked-json";
import { rerunCurrentCommandWithEnv } from "./rerun-current-command";
import { showHumanCheckCard } from "./show-human-check-card";
import type {
  CommandCheckRequirement,
  CommandEntryContext,
  CommandEntryName,
  CommandEntryResult,
} from "./types";

const SKIP_CLI_UPDATE_ENV = "OPENMELD_INTERNAL_SKIP_STARTUP_UPGRADE";
const CLI_UPDATE_STATUS_CODE = "command.entry.cli_update.status";

/**
 * Entries where the cli-update check is skipped entirely (no block, no prompt,
 * no network) even when a required update is pending. This is the local OpenMeld
 * Service's own lifecycle + liveness/diagnostic surface, which the floor gate
 * must not take down — doing so would crash-loop the daemon or blind the GUI's
 * status probe, exactly the availability/observability the owner docs protect.
 * Service compatibility is enforced by the Service Wake gate, not by killing
 * these commands.
 *
 * - `service.run`: the daemon's own runtime entry; launchd/systemd would treat
 *   a `blocked` exit as a crash and restart-loop it (no tty, no skip env).
 * - `service.status` / `service.snapshot`: local liveness/diagnostic probes the
 *   GUI reads unauthenticated; they must report state, not an upgrade error.
 * - `doctor`: surfaces the pending required update as its own top check instead
 *   of being blocked or prompted by the entry gate.
 *
 * Self-rescue commands (`setup`, `upgrade`, `auth.*`, `reset`, `uninstall`,
 * `repair.local-state`) are already exempt structurally — they never carry the
 * check. `openmeld --version` is handled by the argument parser before any entry
 * check runs.
 */
const CLI_UPDATE_CHECK_EXEMPT_ENTRIES: ReadonlySet<CommandEntryName> = new Set([
  "doctor",
  "service.run",
  "service.status",
  "service.snapshot",
]);

export async function runCliUpdateCheck(input: {
  context: CommandEntryContext;
  requirement: CommandCheckRequirement;
}): Promise<CommandEntryResult> {
  if (input.requirement.mode === "skip") {
    return { status: "continue" };
  }
  // The post-upgrade rerun sets this env to avoid re-triggering the gate after
  // it just upgraded; required mode must keep honoring it or the rerun would be
  // blocked by its own check.
  if (String(process.env[SKIP_CLI_UPDATE_ENV] ?? "").trim() === "1") {
    return { status: "continue" };
  }
  // A dispatch-owned runtime is the headless agent the local daemon spawns for a
  // Wake turn. The agent acts only through nested `openmeld space ...` calls, which
  // run this entry flow with no tty and an agent-resolved view — so a breached
  // required floor would block every action mid-turn (the agent wakes but can
  // never reply) until the user manually upgrades. `service.run` (the daemon
  // itself) is already exempt above for the same reason; the child commands it
  // dispatches must be too. CLI/service version compatibility is enforced by the
  // Service Wake gate, not by muzzling the agent here.
  if (readDispatchOwnedRuntimeGuard().active) {
    return { status: "continue" };
  }
  // The service lifecycle/liveness surface and `doctor` skip the gate entirely:
  // never block, prompt, or probe the network for them.
  if (CLI_UPDATE_CHECK_EXEMPT_ENTRIES.has(input.context.entryName)) {
    return { status: "continue" };
  }
  if (!isCliUpdateCheckApplicable(input.context.environmentTarget)) {
    return { status: "continue" };
  }

  const assessment = await assessCliUpdate({
    environmentTarget: input.context.environmentTarget,
  });
  // Fail-open: no authoritative signal, or already current → never block.
  if (!(assessment.latestVersion && assessment.updateAvailable)) {
    return { status: "continue" };
  }

  const isRequired =
    input.requirement.mode === "required" || assessment.floorBreached;

  if (
    input.context.runtime.resolvedView !== "human" ||
    !input.context.allowPrompt
  ) {
    return resolveNonInteractiveCliUpdateResult({
      assessment,
      context: input.context,
      isRequired,
    });
  }

  return await resolveHumanCliUpdateResult({
    assessment,
    context: input.context,
    isRequired,
  });
}

function resolveNonInteractiveCliUpdateResult(input: {
  assessment: CliUpdateAssessment;
  context: CommandEntryContext;
  isRequired: boolean;
}): CommandEntryResult {
  const copy = getCommandEntryCopy(input.context.entryName);
  const { currentVersion, latestVersion, requiredFloor } = input.assessment;
  const nextSteps = formatOpenMeldCliCommands(["openmeld upgrade --yes"]);

  if (input.isRequired) {
    const targetVersion = requiredFloor ?? latestVersion;
    const message = `A required OpenMeld CLI update is available. Update OpenMeld CLI from ${currentVersion} to at least ${targetVersion} before ${copy.cliUpdateAction}.`;
    input.context.presenter.data({
      code: CLI_UPDATE_STATUS_CODE,
      payload: buildAgentCheckResult({
        code: ENTRY_CHECK_BLOCKED_ERROR_CODES.cliUpdate,
        status: "blocked",
        reason: message,
        nextSteps,
        humanActionRequired: input.context.runtime.resolvedView === "agent",
        canContinueAfterFix: false,
        details: {
          currentVersion,
          latestVersion,
          requiredVersion: requiredFloor,
        },
      }),
    });
    return buildBlockedEntryCheckResult({
      code: ENTRY_CHECK_BLOCKED_ERROR_CODES.cliUpdate,
      message,
    });
  }

  // Optional update available. Under `--json` we stay silent so machine output
  // is never polluted by a non-blocking notice; other non-human views keep the
  // soft "update available" signal.
  if (!input.context.jsonOutput) {
    input.context.presenter.data({
      code: CLI_UPDATE_STATUS_CODE,
      payload: buildAgentCheckResult({
        code: "upgrade.available",
        status: "needs_attention",
        reason: `OpenMeld CLI ${latestVersion} is available.`,
        nextSteps,
        humanActionRequired: input.context.runtime.resolvedView === "agent",
        canContinueAfterFix: true,
        details: {
          currentVersion,
          latestVersion,
        },
      }),
    });
  }
  return { status: "continue" };
}

async function resolveHumanCliUpdateResult(input: {
  assessment: CliUpdateAssessment;
  context: CommandEntryContext;
  isRequired: boolean;
}): Promise<CommandEntryResult> {
  const copy = getCommandEntryCopy(input.context.entryName);
  const { currentVersion, latestVersion } = input.assessment;

  showHumanCheckCard({
    presenter: input.context.presenter,
    codePrefix: "command.entry.cli_update.card",
    title: input.isRequired
      ? `OpenMeld CLI must be updated before ${copy.cliUpdateAction}`
      : "OpenMeld CLI Update Available",
    status: `You're using OpenMeld CLI ${currentVersion}. ${latestVersion} is ready.`,
    why: input.isRequired
      ? "This update is required and replaces an unsupported OpenMeld CLI version."
      : "Newer builds include fixes and better setup guidance.",
    next: `Choose Upgrade now to finish updating before ${copy.cliUpdateAction}.`,
  });

  const selected = await confirm({
    message: `Upgrade OpenMeld CLI from ${currentVersion} to ${latestVersion} now?`,
    initialValue: true,
  });
  if (isCancel(selected) || !selected) {
    // A required update that the user declines or aborts must not proceed and
    // must surface as a non-zero failure — returning "cancelled" would exit 0
    // and read as success, defeating the gate. An optional update may continue.
    if (input.isRequired) {
      cancel(
        `OpenMeld CLI update required. Run \`openmeld upgrade\` before ${copy.cliUpdateAction}.`
      );
      return { status: "blocked", exitCode: 1 };
    }
    return isCancel(selected)
      ? { status: "cancelled" }
      : { status: "continue" };
  }

  await ensureVersionStateReady({ currentVersion });
  await runUpgrade({
    yes: true,
    view: input.context.runtime.resolvedView,
  });
  const exitCode = await rerunCurrentCommandWithEnv({
    argv: input.context.argv,
    env: {
      [SKIP_CLI_UPDATE_ENV]: "1",
    },
  });
  return {
    status: "blocked",
    exitCode,
  };
}
