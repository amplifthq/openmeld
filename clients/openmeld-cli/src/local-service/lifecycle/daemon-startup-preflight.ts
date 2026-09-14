import { sleep } from "@openmeld/utils";
import {
  type DaemonServiceAlignmentBlockReasonCode,
  type DaemonServiceAlignmentProgressStep,
  runDaemonServiceFullAlignment,
} from "./daemon-service-alignment-executor";
import {
  buildDaemonServiceTargetSpec,
  resolveDaemonServiceAlignmentDecision,
} from "./daemon-service-alignment-target";
import {
  type DaemonServiceAutoHealReport,
  runDaemonServiceAutoHeal,
} from "./daemon-service-auto-heal";
import {
  type DaemonServiceFailureStage,
  formatDaemonFailureContextText,
} from "./daemon-service-evidence";
import type { DaemonServiceAnomalyCode } from "./daemon-service-inventory";
import { inspectDaemonServiceInventory } from "./daemon-service-inventory";

const STARTUP_ALIGNMENT_SETTLE_TIMEOUT_MS = 3000;
const STARTUP_ALIGNMENT_SETTLE_POLL_MS = 150;
const ALIGNMENT_LOCK_CONFLICT_MESSAGE =
  "OpenMeld service alignment is already running in another local process.";

export type DaemonStartupPreflightProgress = {
  onProgress: (
    step: DaemonServiceAlignmentProgressStep
  ) => Promise<void> | void;
  complete: (message?: string) => void;
  fail: () => void;
};

const noopStartupPreflightProgress: DaemonStartupPreflightProgress = {
  onProgress: () => undefined,
  complete: () => undefined,
  fail: () => undefined,
};

export type DaemonStartupPreflightResult =
  | {
      status: "already_aligned" | "not_installed";
      reasonCodes: DaemonServiceAnomalyCode[];
      errorMessage: null;
      cooldownUntil: null;
      backupDataPath: null;
    }
  | {
      status: "auto_healed" | "aligned";
      reasonCodes: [];
      errorMessage: null;
      cooldownUntil: null;
      backupDataPath: null;
    }
  | {
      status: "blocked";
      reasonCodes: (
        | DaemonServiceAnomalyCode
        | DaemonServiceAlignmentBlockReasonCode
      )[];
      errorMessage: string | null;
      cooldownUntil: string | null;
      backupDataPath: null;
    }
  | {
      status: "failed";
      reasonCodes: [];
      errorMessage: string;
      cooldownUntil: null;
      backupDataPath: string | null;
      failureStage?: string | null;
      evidencePath?: string | null;
    };

export async function runDaemonStartupPreflight(input: {
  expectedVersion: string;
  cliScriptPath?: string;
  view?: "human" | "agent";
  progress?: DaemonStartupPreflightProgress;
}): Promise<DaemonStartupPreflightResult> {
  const target = buildDaemonServiceTargetSpec({
    daemonVersion: input.expectedVersion,
  });
  const initialInventory = await inspectDaemonServiceInventory({
    expectedVersion: input.expectedVersion,
    intendedMode: "background",
    intent: "startup_check",
  });
  const initialDecision = resolveDaemonServiceAlignmentDecision({
    inventory: initialInventory,
    target,
  });

  if (
    initialDecision.status === "already_aligned" ||
    initialDecision.status === "not_installed" ||
    initialDecision.status === "blocked"
  ) {
    return {
      status: initialDecision.status,
      reasonCodes: initialDecision.reasonCodes,
      errorMessage: null,
      cooldownUntil: null,
      backupDataPath: null,
    };
  }

  if (initialDecision.status === "needs_auto_heal") {
    return await runDaemonStartupAutoHeal({
      expectedVersion: input.expectedVersion,
      cliScriptPath: input.cliScriptPath,
      decisionReasonCodes: initialDecision.reasonCodes,
    });
  }

  const alignmentProgressUi = input.progress ?? noopStartupPreflightProgress;
  const alignmentResult = await runDaemonServiceFullAlignment({
    expectedVersion: input.expectedVersion,
    intent: "startup_check",
    ...(input.cliScriptPath ? { cliScriptPath: input.cliScriptPath } : {}),
    onProgress: alignmentProgressUi.onProgress,
  });
  return await mapAlignmentResultToStartupPreflightResult({
    alignmentProgressUi,
    alignmentResult,
    cliScriptPath: input.cliScriptPath,
    expectedVersion: input.expectedVersion,
  });
}

async function mapAlignmentResultToStartupPreflightResult(input: {
  alignmentProgressUi: DaemonStartupPreflightProgress;
  alignmentResult: Awaited<ReturnType<typeof runDaemonServiceFullAlignment>>;
  cliScriptPath?: string;
  expectedVersion: string;
}): Promise<DaemonStartupPreflightResult> {
  const { alignmentProgressUi, alignmentResult } = input;
  if (alignmentResult.status === "already_aligned") {
    alignmentProgressUi.complete(
      "OpenMeld aligned the local background service."
    );
    return {
      status: "already_aligned",
      reasonCodes: [],
      errorMessage: null,
      cooldownUntil: null,
      backupDataPath: null,
    };
  }

  if (alignmentResult.status === "aligned") {
    alignmentProgressUi.complete(
      "OpenMeld repaired and aligned the local background service."
    );
    return {
      status: "aligned",
      reasonCodes: [],
      errorMessage: null,
      cooldownUntil: null,
      backupDataPath: null,
    };
  }

  if (alignmentResult.status === "stopped_safe") {
    alignmentProgressUi.fail();
    return {
      status: "failed",
      reasonCodes: [],
      errorMessage: formatStartupPreflightFailureMessage({
        backupDataPath: null,
        errorMessage: `${alignmentResult.errorMessage}. OpenMeld left the current service version safely stopped instead of restoring an older background state. Run \`openmeld service start\` to start it again.`,
        failureStage: alignmentResult.failureStage ?? null,
        evidencePath: alignmentResult.evidencePath ?? null,
      }),
      cooldownUntil: null,
      backupDataPath: null,
      ...(alignmentResult.failureStage
        ? { failureStage: alignmentResult.failureStage }
        : {}),
      ...(alignmentResult.evidencePath
        ? { evidencePath: alignmentResult.evidencePath }
        : {}),
    };
  }

  alignmentProgressUi.fail();

  if (alignmentResult.status === "blocked") {
    return {
      status: "blocked",
      reasonCodes: alignmentResult.reasonCodes,
      errorMessage: null,
      cooldownUntil: null,
      backupDataPath: null,
    };
  }

  if (alignmentResult.errorMessage === ALIGNMENT_LOCK_CONFLICT_MESSAGE) {
    const settledResult = await waitForDaemonStartupAlignmentSettlement({
      expectedVersion: input.expectedVersion,
      cliScriptPath: input.cliScriptPath,
      timeoutMs: STARTUP_ALIGNMENT_SETTLE_TIMEOUT_MS,
      pollMs: STARTUP_ALIGNMENT_SETTLE_POLL_MS,
    });
    if (settledResult) {
      return settledResult;
    }
  }

  return {
    status: "failed",
    reasonCodes: [],
    errorMessage: formatStartupPreflightFailureMessage({
      backupDataPath: alignmentResult.backupDataPath,
      errorMessage: alignmentResult.errorMessage,
      failureStage: alignmentResult.failureStage ?? null,
      evidencePath: alignmentResult.evidencePath ?? null,
    }),
    cooldownUntil: null,
    backupDataPath: alignmentResult.backupDataPath,
    ...(alignmentResult.failureStage
      ? { failureStage: alignmentResult.failureStage }
      : {}),
    ...(alignmentResult.evidencePath
      ? { evidencePath: alignmentResult.evidencePath }
      : {}),
  };
}

async function runDaemonStartupAutoHeal(input: {
  expectedVersion: string;
  cliScriptPath?: string;
  decisionReasonCodes: DaemonServiceAnomalyCode[];
}): Promise<DaemonStartupPreflightResult> {
  const autoHealReport = await runDaemonServiceAutoHeal({
    expectedVersion: input.expectedVersion,
    intent: "startup_check",
    ...(input.cliScriptPath ? { cliScriptPath: input.cliScriptPath } : {}),
  });

  return mapAutoHealReportToStartupPreflightResult({
    autoHealReport,
    fallbackReasonCodes: input.decisionReasonCodes,
  });
}

function formatStartupPreflightFailureMessage(input: {
  backupDataPath: string | null;
  errorMessage: string;
  failureStage: DaemonServiceFailureStage | null;
  evidencePath: string | null;
}): string {
  const failureContext = formatDaemonFailureContextText({
    backupDataPath: input.backupDataPath,
    evidencePath: input.evidencePath,
    failureStage: input.failureStage,
  });
  return failureContext.length > 0
    ? `${input.errorMessage}. ${failureContext}`
    : input.errorMessage;
}

function mapAutoHealReportToStartupPreflightResult(input: {
  autoHealReport: DaemonServiceAutoHealReport;
  fallbackReasonCodes: DaemonServiceAnomalyCode[];
}): DaemonStartupPreflightResult {
  if (input.autoHealReport.status === "repaired") {
    return {
      status: "auto_healed",
      reasonCodes: [],
      errorMessage: null,
      cooldownUntil: null,
      backupDataPath: null,
    };
  }

  if (input.autoHealReport.status === "noop") {
    return {
      status: "already_aligned",
      reasonCodes: [],
      errorMessage: null,
      cooldownUntil: null,
      backupDataPath: null,
    };
  }

  if (input.autoHealReport.status === "cooldown") {
    return {
      status: "blocked",
      reasonCodes: input.fallbackReasonCodes,
      errorMessage:
        input.autoHealReport.errorMessage ??
        "OpenMeld background service automatic repair is cooling down after repeated failures.",
      cooldownUntil: input.autoHealReport.cooldownUntil,
      backupDataPath: null,
    };
  }

  if (input.autoHealReport.status === "blocked") {
    return {
      status: "blocked",
      reasonCodes:
        input.autoHealReport.blockedAnomalyCodes.length > 0
          ? input.autoHealReport.blockedAnomalyCodes
          : input.fallbackReasonCodes,
      errorMessage: null,
      cooldownUntil: null,
      backupDataPath: null,
    };
  }

  return {
    status: "failed",
    reasonCodes: [],
    errorMessage:
      input.autoHealReport.errorMessage ??
      "OpenMeld background service automatic repair failed.",
    cooldownUntil: null,
    backupDataPath: null,
  };
}

async function waitForDaemonStartupAlignmentSettlement(input: {
  expectedVersion: string;
  cliScriptPath?: string;
  timeoutMs: number;
  pollMs: number;
}): Promise<DaemonStartupPreflightResult | null> {
  const target = buildDaemonServiceTargetSpec({
    daemonVersion: input.expectedVersion,
  });
  const deadline = Date.now() + input.timeoutMs;

  while (Date.now() < deadline) {
    const inventory = await inspectDaemonServiceInventory({
      expectedVersion: input.expectedVersion,
      intendedMode: "background",
      intent: "startup_check",
    }).catch(() => null);
    if (!inventory) {
      await sleep(input.pollMs);
      continue;
    }
    const decision = resolveDaemonServiceAlignmentDecision({
      inventory,
      target,
    });
    if (decision.status === "already_aligned") {
      return {
        status: "already_aligned",
        reasonCodes: [],
        errorMessage: null,
        cooldownUntil: null,
        backupDataPath: null,
      };
    }
    if (decision.status === "not_installed" || decision.status === "blocked") {
      return {
        status: decision.status,
        reasonCodes: decision.reasonCodes,
        errorMessage: null,
        cooldownUntil: null,
        backupDataPath: null,
      };
    }
    await sleep(input.pollMs);
  }

  return null;
}
