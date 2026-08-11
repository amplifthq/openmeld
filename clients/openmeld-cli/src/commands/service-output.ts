import { shouldEmitAgentOverview } from "../runtime/agent-overview-output";
import { formatOpenMeldCliTextBlock } from "../runtime/cli-entry-command";
import type { RuntimeContext } from "../runtime/context";
import type { createPresenter, Presenter } from "../runtime/presenter/index";
import {
  buildDaemonStartDeferredCard,
  buildDaemonStartNeedsAttentionCard,
} from "../system/local-service-start-decision";
import {
  createDelayedSpinner,
  type DelayedSpinner,
} from "../ui/delayed-spinner";
import { renderInfoCard } from "../ui/info-card";
import { emitDaemonAgentOverview } from "./service-agent-overview";

type DaemonStartSpinner = {
  clear: () => void;
  message: (message: string) => void;
  start: (message: string) => void;
};

export const NOOP_PRESENTER_METHOD = (): void => {
  // Intentionally silent for internal command orchestration.
};

export function createSilentPresenter(
  view: RuntimeContext["resolvedView"]
): Presenter {
  return {
    view,
    data: NOOP_PRESENTER_METHOD,
    event: NOOP_PRESENTER_METHOD,
    line: NOOP_PRESENTER_METHOD,
  };
}

export function renderServiceActionCard(input: {
  presenter: ReturnType<typeof createPresenter>;
  codePrefix: string;
  title: string;
  rows: Array<{ label: string; value: string }>;
}): void {
  renderInfoCard({
    presenter: input.presenter,
    codePrefix: input.codePrefix,
    title: input.title,
    rows: formatDaemonDisplayRows(input.rows),
  });
}

export function formatDaemonDisplayRows(
  rows: Array<{ label: string; value: string }>
): Array<{ label: string; value: string }> {
  return rows.map((row) => ({
    ...row,
    value: formatOpenMeldCliTextBlock(row.value),
  }));
}

export function emitDaemonOverviewIfAgent(input: {
  presenter: ReturnType<typeof createPresenter>;
  resolvedView: RuntimeContext["resolvedView"];
  command:
    | "menu"
    | "run"
    | "status"
    | "snapshot"
    | "install"
    | "reinstall"
    | "uninstall"
    | "stop"
    | "interrupt"
    | "cancel";
  handled?: boolean;
}): void {
  if (
    !shouldEmitAgentOverview({
      resolvedView: input.resolvedView,
      handled: input.handled,
    })
  ) {
    return;
  }
  emitDaemonAgentOverview({
    presenter: input.presenter,
    command: input.command,
  });
}

export function renderDaemonStartDeferredCard(input: {
  presenter: ReturnType<typeof createPresenter>;
  codePrefix: string;
}): void {
  const card = buildDaemonStartDeferredCard();
  renderServiceActionCard({
    presenter: input.presenter,
    codePrefix: input.codePrefix,
    title: card.title,
    rows: card.rows,
  });
}

export function renderDaemonStartNeedsAttentionCard(input: {
  presenter: ReturnType<typeof createPresenter>;
  codePrefix: string;
  summary: string;
  nextStep?: string;
  autoRepairAttempted?: boolean;
  detail?: string;
}): void {
  const card = buildDaemonStartNeedsAttentionCard({
    summary: input.summary,
    nextStep: input.nextStep,
    autoRepairAttempted: input.autoRepairAttempted,
    detail: input.detail,
  });
  renderServiceActionCard({
    presenter: input.presenter,
    codePrefix: input.codePrefix,
    title: card.title,
    rows: card.rows,
  });
}

export function createDaemonStartSpinner(input: {
  runtime: RuntimeContext;
  suppress?: boolean;
}): DaemonStartSpinner | null {
  if (input.suppress === true) {
    return null;
  }
  if (input.runtime.resolvedView !== "human") {
    return null;
  }
  if (process.stdout.isTTY !== true) {
    return null;
  }
  let spinner: DelayedSpinner | null = null;
  return {
    clear: () => {
      spinner?.complete();
      spinner = null;
    },
    message: (message) => {
      spinner?.message(message);
    },
    start: (message) => {
      spinner = createDelayedSpinner({
        enabled: true,
        message,
      });
      spinner.start();
    },
  };
}

export function createQuietPresenter(
  runtime: RuntimeContext
): ReturnType<typeof createPresenter> {
  return {
    view: runtime.resolvedView,
    event: () => undefined,
    line: () => undefined,
    data: () => undefined,
  };
}

export function normalizeText(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim().toLowerCase();
}
