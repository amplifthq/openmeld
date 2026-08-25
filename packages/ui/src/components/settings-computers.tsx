import type { AgentControllerUsageLimits } from "@openmeld/schemas/types";
import {
  DesktopTowerIcon,
  PlusIcon,
  PulseIcon,
  RobotIcon,
} from "@phosphor-icons/react";
import { Fragment, type ReactNode } from "react";
import { Badge } from "#components/badge";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "#components/card";
import { LocalAgentLogo } from "#components/local-agent-logo";
import { hasLocalAgentLogo } from "#components/local-agent-logo-utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "#components/tooltip";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "#fluid/accordion";
import {
  resolveStatusToneAdvisoryBadgeClassName,
  resolveStatusToneIndicatorClassName,
  resolveStatusToneRingIndicatorClassName,
  resolveStatusToneSoftTextClassName,
  resolveStatusToneStrongTextClassName,
} from "#lib/status-tone";
import { cn } from "#lib/utils";

export type SettingsComputerLocalAgentIcon = {
  agentId: string;
  displayName: string;
};

export type SettingsComputerSummaryStatus = {
  label: string;
  showLabel: boolean;
  tone: "checking" | "danger" | "muted" | "ready" | "warning";
};

const EMPTY_COMPUTER_LOCAL_AGENT_ICONS =
  [] as const satisfies readonly SettingsComputerLocalAgentIcon[];

export type SettingsComputerSummaryCardContentProps = {
  className?: string;
  icon?: ReactNode;
  lastSeenLabel: string;
  localAgents?: readonly SettingsComputerLocalAgentIcon[];
  localAgentsSummaryLabel?: string;
  name: string;
  platformLabel: string;
  recordBadgeLabel?: string | null;
  status: SettingsComputerSummaryStatus | null;
  statusIndicatorTestId?: string;
};

export function SettingsComputerSummaryCardContent({
  className,
  icon,
  lastSeenLabel,
  localAgents = EMPTY_COMPUTER_LOCAL_AGENT_ICONS,
  localAgentsSummaryLabel,
  name,
  platformLabel,
  recordBadgeLabel,
  status,
  statusIndicatorTestId,
}: SettingsComputerSummaryCardContentProps) {
  return (
    <div
      className={cn(
        "flex h-full w-full min-w-0 flex-1 flex-col justify-between gap-3 px-3.5 pt-4 pb-3",
        className
      )}
    >
      <div className="flex min-w-0 items-start justify-between gap-3 pr-16">
        <div className="flex min-w-0 items-start gap-2.5">
          <span className="grid h-8 w-8 shrink-0 place-items-center border border-border/70 bg-background/45 text-muted-foreground transition-colors group-data-[state=active]:text-foreground">
            {icon ?? (
              <DesktopTowerIcon aria-hidden="true" className="h-4 w-4" />
            )}
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
              <span className="min-w-0 max-w-full font-medium text-foreground text-sm max-sm:basis-full max-sm:break-words sm:truncate">
                {name}
              </span>
              {recordBadgeLabel ? (
                <Badge className="shrink-0" variant="secondary">
                  {recordBadgeLabel}
                </Badge>
              ) : null}
              {status ? (
                <span className="inline-flex max-w-full shrink-0 items-center gap-2 max-sm:shrink">
                  <span
                    aria-hidden="true"
                    className={cn(
                      "h-2 w-2 rounded-full ring-2",
                      resolveStatusToneRingIndicatorClassName(status.tone)
                    )}
                    data-testid={statusIndicatorTestId}
                  />
                  {status.showLabel ? null : (
                    <span className="sr-only">{status.label}</span>
                  )}
                  {status.showLabel ? (
                    <span
                      className={cn(
                        "min-w-0 font-medium text-xs",
                        resolveStatusToneStrongTextClassName(status.tone)
                      )}
                    >
                      {status.label}
                    </span>
                  ) : null}
                </span>
              ) : null}
            </span>
            <span className="mt-1 block whitespace-normal text-muted-foreground text-xs leading-5">
              {platformLabel}
            </span>
          </span>
        </div>
      </div>

      <div className="grid grid-cols-[1fr_auto] gap-3 border-border/70 border-t pt-2.5 text-xs leading-5">
        <span className="min-w-0 text-muted-foreground">{lastSeenLabel}</span>
        <SettingsComputerLocalAgentSummary
          icons={localAgents}
          summaryLabel={localAgentsSummaryLabel}
        />
      </div>
    </div>
  );
}

export function SettingsAddComputerCardContent({
  description = "Set up OpenMeld Service and local agents.",
  descriptionClassName,
  iconContainerClassName,
  title = "Add a Computer",
  titleClassName,
}: {
  description?: ReactNode;
  descriptionClassName?: string;
  iconContainerClassName?: string;
  title?: string;
  titleClassName?: string;
}) {
  return (
    <>
      <span
        className={cn(
          "grid size-10 place-items-center rounded-md border border-border/70 bg-background/45 text-muted-foreground transition-colors group-hover:text-foreground",
          iconContainerClassName
        )}
      >
        <PlusIcon aria-hidden="true" className="size-5" />
      </span>
      <span className="flex flex-col items-center gap-1">
        <span
          className={cn("font-medium text-foreground text-sm", titleClassName)}
        >
          {title}
        </span>
        <span
          className={cn(
            "max-w-48 text-muted-foreground text-xs leading-5",
            descriptionClassName
          )}
        >
          {description}
        </span>
      </span>
    </>
  );
}

function SettingsComputerLocalAgentSummary({
  icons,
  summaryLabel,
}: {
  icons: readonly SettingsComputerLocalAgentIcon[];
  summaryLabel?: string;
}) {
  const visibleIcons = icons.filter((icon) => hasLocalAgentLogo(icon.agentId));
  if (visibleIcons.length === 0) {
    return summaryLabel ? (
      <span className="shrink-0 text-muted-foreground">{summaryLabel}</span>
    ) : null;
  }

  return (
    <span className="flex shrink-0 items-center justify-end gap-2">
      <span className="sr-only">
        {visibleIcons.map((icon) => icon.displayName).join(", ")}
        {" local agents"}
      </span>
      {visibleIcons.map((icon) => (
        <Tooltip key={icon.agentId}>
          <TooltipTrigger
            render={
              <span className="inline-flex size-5 items-center justify-center opacity-90 transition-opacity hover:opacity-100">
                <LocalAgentLogo agentId={icon.agentId} size="sm" />
              </span>
            }
          />
          <TooltipContent side="top">{icon.displayName}</TooltipContent>
        </Tooltip>
      ))}
    </span>
  );
}

export type SettingsComputerStatusTone =
  | "connected"
  | "checking"
  | "warning"
  | "danger"
  | "muted";

export type SettingsComputerStatusCardProps = {
  action?: ReactNode;
  children?: ReactNode;
  className?: string;
  description: string;
  error?: string | null;
  statusDescription?: string;
  statusLabel: string;
  title?: string;
  tone?: SettingsComputerStatusTone;
};

export function SettingsComputerStatusCard({
  action,
  children,
  className,
  description,
  error,
  statusDescription,
  statusLabel,
  title = "OpenMeld Service",
  tone = "muted",
}: SettingsComputerStatusCardProps) {
  return (
    <Card className={className} data-testid="settings-computer-status-card">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <PulseIcon className="h-5 w-5" />
          {title}
        </CardTitle>
        <CardDescription>{description}</CardDescription>
        {action ? <CardAction>{action}</CardAction> : null}
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 space-y-1.5">
            <p
              className={cn(
                "flex items-center gap-2 font-medium text-sm",
                resolveStatusTextClassName(tone)
              )}
            >
              <span
                aria-hidden="true"
                className={cn(
                  "h-2 w-2 shrink-0 rounded-full",
                  resolveStatusDotClassName(tone)
                )}
              />
              {statusLabel}
            </p>
            {statusDescription ? (
              <p className="max-w-2xl text-muted-foreground text-xs leading-5">
                {statusDescription}
              </p>
            ) : null}
          </div>
        </div>
        {error ? (
          <p className="text-destructive text-xs" role="alert">
            {error}
          </p>
        ) : null}
        {children}
      </CardContent>
    </Card>
  );
}

export type SettingsLocalAgentRowSummaryStatus = {
  label: ReactNode;
  tone?: "danger" | "muted" | "warning";
};

export type SettingsLocalAgentRow = {
  badge?: ReactNode;
  control?: ReactNode;
  defaultExpanded?: boolean;
  description?: string;
  descriptionTone?: "default" | "warning";
  detail?: ReactNode;
  displayName: string;
  id: string;
  logoAgentId?: string;
  muted?: boolean;
  summaryAccessory?: ReactNode;
  summaryMeta?: ReactNode;
  summaryStatus?: SettingsLocalAgentRowSummaryStatus;
  summaryStatuses?: readonly SettingsLocalAgentRowSummaryStatus[];
};

const LOW_CAPACITY_REMAINING_THRESHOLD_PERCENT = 20;
const US_USAGE_PERCENT_FORMATTER = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 1,
});
const US_USAGE_TIME_FORMATTER = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeStyle: "short",
});

type UsageLimitPresentation = {
  label:
    | "Available"
    | "Exhausted"
    | "Low"
    | "Stale"
    | "Unavailable"
    | "Unsupported";
  tone: "danger" | "muted" | "ready" | "warning";
};

type UsageLimitSummary = {
  accessibleDetails: string;
  presentation: UsageLimitPresentation;
  remainingPercent: number;
};

export function SettingsLocalAgentUsageSummary({
  agentName,
  limits,
  nowMs = Date.now(),
}: {
  agentName: string;
  limits?: AgentControllerUsageLimits;
  nowMs?: number;
}) {
  const summary = resolveUsageLimitSummary(limits);
  if (!summary) {
    return null;
  }
  const accessibleLabel = `${agentName} usage limits, ${summary.accessibleDetails}`;
  const remainingPercentLabel = formatRemainingPercent(
    summary.remainingPercent
  );
  const orderedLimits = orderUsageLimitsForDisplay({ agentName, limits });

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            aria-label={accessibleLabel}
            aria-valuemax={100}
            aria-valuemin={0}
            aria-valuenow={summary.remainingPercent}
            aria-valuetext={`${remainingPercentLabel} left`}
            className="inline-flex h-5 shrink-0 items-center gap-1 font-medium text-xs tabular-nums"
            data-testid="local-agent-usage-summary"
            role="progressbar"
          >
            <UsageLimitRing
              className="size-4"
              remainingPercent={summary.remainingPercent}
              tone={summary.presentation.tone}
            />
            <span>{remainingPercentLabel}</span>
          </span>
        }
      />
      <TooltipContent
        className="min-w-64 max-w-sm flex-col items-stretch gap-2.5 whitespace-normal text-left"
        side="top"
      >
        <span className="font-medium">Usage limits</span>
        {orderedLimits && orderedLimits.length > 0 ? (
          <span className="grid gap-2">
            {orderedLimits.map((limit) => (
              <UsageLimitPreview key={limit.key} limit={limit} nowMs={nowMs} />
            ))}
          </span>
        ) : (
          <span className="text-background/75">
            Not reported by provider yet.
          </span>
        )}
        <span className="border-background/20 border-t pt-2 text-background/75">
          Select this agent to view details.
        </span>
      </TooltipContent>
    </Tooltip>
  );
}

function UsageLimitPreview({
  limit,
  nowMs,
}: {
  limit: AgentControllerUsageLimits[number];
  nowMs: number;
}) {
  const presentation = resolveUsageLimitPresentation(limit);
  const remainingPercent = resolveRemainingPercent(limit.usedPercent);
  return (
    <span className="grid gap-0.5">
      <span className="font-medium">{limit.label}</span>
      <span>
        {remainingPercent === null
          ? resolveMissingUsageCopy(limit.status)
          : `${formatRemainingPercent(remainingPercent)} left`}
        {" · "}
        {presentation.label}
      </span>
      <span className="text-background/75">
        {formatUsageLimitReset(limit.resetsAt, nowMs)} ·{" "}
        {formatUsageLimitObservation({
          nowMs,
          observedAt: limit.observedAt,
          stale: limit.status === "stale",
        })}
      </span>
    </span>
  );
}

export function SettingsLocalAgentUsageLimits({
  agentName,
  limits,
  nowMs = Date.now(),
}: {
  agentName: string;
  limits?: AgentControllerUsageLimits;
  nowMs?: number;
}) {
  if (limits === undefined) {
    return null;
  }
  const orderedLimits = orderUsageLimitsForDisplay({ agentName, limits });

  return (
    <section aria-label={`${agentName} usage limits`} className="space-y-2.5">
      <div>
        <h4 className="font-medium text-sm">Usage limits</h4>
        <p className="mt-0.5 text-muted-foreground text-xs leading-5">
          Capacity reported by the provider. This does not control whether the
          agent can run.
        </p>
      </div>
      {orderedLimits && orderedLimits.length > 0 ? (
        <div
          className="grid gap-2.5 md:grid-cols-3"
          data-testid="local-agent-usage-limit-grid"
        >
          {orderedLimits.map((limit) => (
            <SettingsLocalAgentUsageLimitGauge
              agentName={agentName}
              key={limit.key}
              limit={limit}
              nowMs={nowMs}
            />
          ))}
        </div>
      ) : (
        <div className="rounded-md border border-border/70 bg-muted/15 px-3 py-2.5">
          <div className="flex items-center justify-between gap-3">
            <span className="font-medium text-sm">Usage limits</span>
            <Badge variant="secondary">Unavailable</Badge>
          </div>
          <p className="mt-1 text-muted-foreground text-xs leading-5">
            Not reported by provider yet.
          </p>
        </div>
      )}
    </section>
  );
}

function SettingsLocalAgentUsageLimitGauge({
  agentName,
  limit,
  nowMs,
}: {
  agentName: string;
  limit: AgentControllerUsageLimits[number];
  nowMs: number;
}) {
  const presentation = resolveUsageLimitPresentation(limit);
  const remainingPercent = resolveRemainingPercent(limit.usedPercent);
  const resetLabel = formatUsageLimitReset(limit.resetsAt, nowMs);
  const observedLabel = formatUsageLimitObservation({
    nowMs,
    observedAt: limit.observedAt,
    stale: limit.status === "stale",
  });
  const accessibleLabel = [
    `${agentName} ${limit.label}`,
    remainingPercent === null
      ? null
      : `${formatRemainingPercent(remainingPercent)} left`,
    presentation.label,
    resetLabel,
    observedLabel,
  ]
    .filter(Boolean)
    .join(", ");

  return (
    <div className="grid min-h-52 min-w-0 grid-rows-[auto_1fr_auto] rounded-md border border-border/70 bg-background/45 px-3 py-3">
      <p className="min-h-10 text-center font-medium text-sm leading-5">
        {limit.label}
      </p>
      <div className="flex min-h-28 flex-col items-center justify-center gap-2 py-2">
        {remainingPercent === null ? (
          <p className="max-w-40 text-center text-muted-foreground text-xs leading-5">
            {resolveMissingUsageCopy(limit.status)}
          </p>
        ) : (
          <div
            aria-label={accessibleLabel}
            aria-valuemax={100}
            aria-valuemin={0}
            aria-valuenow={remainingPercent}
            aria-valuetext={`${formatRemainingPercent(remainingPercent)} left`}
            className="relative grid size-20 place-items-center"
            role="progressbar"
          >
            <UsageLimitRing
              className="absolute inset-0 size-full"
              remainingPercent={remainingPercent}
              strokeWidth={2}
              tone={presentation.tone}
            />
            <span className="flex flex-col items-center font-medium tabular-nums leading-none">
              <span className="text-sm" data-usage-limit-value>
                {formatRemainingPercent(remainingPercent)}
              </span>
              <span
                className="mt-1 text-[9px] text-muted-foreground"
                data-usage-limit-unit
              >
                left
              </span>
            </span>
          </div>
        )}
        <Badge
          className={resolveUsageLimitBadgeClassName(presentation.tone)}
          variant="secondary"
        >
          {presentation.label}
        </Badge>
      </div>
      <div className="grid gap-0.5 border-border/60 border-t pt-2.5 text-center text-muted-foreground text-xs leading-5">
        <UsageLimitTime dateTime={limit.resetsAt} label={resetLabel} />
        <UsageLimitTime dateTime={limit.observedAt} label={observedLabel} />
      </div>
    </div>
  );
}

function UsageLimitRing({
  className,
  remainingPercent,
  strokeWidth = 2.5,
  tone,
}: {
  className?: string;
  remainingPercent: number;
  strokeWidth?: number;
  tone: UsageLimitPresentation["tone"];
}) {
  return (
    <svg
      aria-hidden="true"
      className={cn(
        "-rotate-90",
        resolveStatusToneStrongTextClassName(tone),
        className
      )}
      viewBox="0 0 20 20"
    >
      <circle
        className="text-muted-foreground/20"
        cx="10"
        cy="10"
        fill="none"
        r="7.5"
        stroke="currentColor"
        strokeWidth={strokeWidth}
      />
      <circle
        cx="10"
        cy="10"
        fill="none"
        pathLength="100"
        r="7.5"
        stroke="currentColor"
        strokeDasharray={`${remainingPercent} 100`}
        strokeLinecap="round"
        strokeWidth={strokeWidth}
      />
    </svg>
  );
}

function orderUsageLimitsForDisplay(input: {
  agentName: string;
  limits?: AgentControllerUsageLimits;
}): AgentControllerUsageLimits | undefined {
  if (
    input.agentName.trim().toLocaleLowerCase("en-US") !== "codex" ||
    !input.limits?.some(isCodexOverallWeeklyUsageLimit)
  ) {
    return input.limits;
  }
  return input.limits.toSorted(
    (left, right) =>
      Number(isCodexOverallWeeklyUsageLimit(right)) -
      Number(isCodexOverallWeeklyUsageLimit(left))
  );
}

function isCodexOverallWeeklyUsageLimit(
  limit: AgentControllerUsageLimits[number]
): boolean {
  return limit.label.trim().toLocaleLowerCase("en-US") === "weekly usage";
}

function UsageLimitTime({
  dateTime,
  label,
}: {
  dateTime: string | null;
  label: string;
}) {
  return dateTime ? (
    <time dateTime={dateTime} title={formatExactUsageLimitTime(dateTime)}>
      {label}
    </time>
  ) : (
    <span>{label}</span>
  );
}

function resolveUsageLimitPresentation(
  limit: AgentControllerUsageLimits[number]
): UsageLimitPresentation {
  if (limit.status === "exhausted") {
    return { label: "Exhausted", tone: "danger" };
  }
  if (limit.status === "stale") {
    return { label: "Stale", tone: "warning" };
  }
  if (limit.status === "unavailable") {
    return { label: "Unavailable", tone: "muted" };
  }
  if (limit.status === "unsupported") {
    return { label: "Unsupported", tone: "muted" };
  }
  const remainingPercent = resolveRemainingPercent(limit.usedPercent);
  if (
    remainingPercent !== null &&
    remainingPercent <= LOW_CAPACITY_REMAINING_THRESHOLD_PERCENT
  ) {
    return { label: "Low", tone: "warning" };
  }
  return { label: "Available", tone: "ready" };
}

function resolveUsageLimitSummary(
  limits?: AgentControllerUsageLimits
): UsageLimitSummary | null {
  const quantifiedLimits = (limits ?? []).filter(
    (limit) => limit.usedPercent !== null
  );
  const [firstLimit, ...remainingLimits] = quantifiedLimits;
  if (!firstLimit) {
    return null;
  }

  let selectedLimit = firstLimit;
  let selectedPresentation = resolveUsageLimitPresentation(selectedLimit);
  for (const limit of remainingLimits) {
    const presentation = resolveUsageLimitPresentation(limit);
    const selectedPriority = resolveUsageLimitSummaryPriority(
      selectedPresentation.label
    );
    const priority = resolveUsageLimitSummaryPriority(presentation.label);
    if (
      priority > selectedPriority ||
      (priority === selectedPriority &&
        (limit.usedPercent ?? -1) > (selectedLimit.usedPercent ?? -1))
    ) {
      selectedLimit = limit;
      selectedPresentation = presentation;
    }
  }

  const remainingPercent = resolveRemainingPercent(selectedLimit.usedPercent);
  if (remainingPercent === null) {
    return null;
  }

  return {
    accessibleDetails: `${formatRemainingPercent(remainingPercent)} left, ${selectedPresentation.label}`,
    presentation: selectedPresentation,
    remainingPercent,
  };
}

function resolveUsageLimitSummaryPriority(
  label: UsageLimitPresentation["label"]
): number {
  switch (label) {
    case "Exhausted":
      return 6;
    case "Stale":
      return 5;
    case "Low":
      return 4;
    case "Unavailable":
      return 3;
    case "Unsupported":
      return 2;
    default:
      return 1;
  }
}

function resolveMissingUsageCopy(
  status: AgentControllerUsageLimits[number]["status"]
): string {
  if (status === "unsupported") {
    return "Not reported by provider.";
  }
  if (status === "unavailable") {
    return "Temporarily unavailable.";
  }
  return "Usage percentage not reported.";
}

function formatRemainingPercent(value: number): string {
  return `${US_USAGE_PERCENT_FORMATTER.format(value)}%`;
}

function resolveRemainingPercent(usedPercent: number | null): number | null {
  if (usedPercent === null) {
    return null;
  }
  const remainingPercent = Math.round((100 - usedPercent) * 10) / 10;
  return Math.max(0, Math.min(100, remainingPercent));
}

function formatUsageLimitReset(resetsAt: string | null, nowMs: number): string {
  if (!resetsAt) {
    return "Reset time not reported";
  }
  const resetAtMs = Date.parse(resetsAt);
  if (!Number.isFinite(resetAtMs)) {
    return "Reset time not reported";
  }
  const remainingMs = resetAtMs - nowMs;
  if (remainingMs <= 0) {
    return "Reset time passed";
  }
  return `Resets ${formatRelativeFutureDuration(remainingMs)}`;
}

function formatUsageLimitObservation(input: {
  nowMs: number;
  observedAt: string;
  stale: boolean;
}): string {
  const observedAtMs = Date.parse(input.observedAt);
  if (!Number.isFinite(observedAtMs)) {
    return input.stale
      ? "Last updated time unavailable"
      : "Updated time unavailable";
  }
  const elapsedMs = Math.max(0, input.nowMs - observedAtMs);
  const prefix = input.stale ? "Last updated" : "Updated";
  return `${prefix} ${formatRelativePastDuration(elapsedMs)}`;
}

function formatRelativeFutureDuration(durationMs: number): string {
  const minutes = Math.floor(durationMs / 60_000);
  if (minutes < 1) {
    return "in less than a minute";
  }
  if (minutes < 60) {
    return `in ${minutes} ${minutes === 1 ? "minute" : "minutes"}`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `in ${hours} ${hours === 1 ? "hour" : "hours"}`;
  }
  const days = Math.floor(hours / 24);
  return `in ${days} ${days === 1 ? "day" : "days"}`;
}

function formatRelativePastDuration(durationMs: number): string {
  const minutes = Math.floor(durationMs / 60_000);
  if (minutes < 1) {
    return "just now";
  }
  if (minutes < 60) {
    return `${minutes} ${minutes === 1 ? "minute" : "minutes"} ago`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours} ${hours === 1 ? "hour" : "hours"} ago`;
  }
  const days = Math.floor(hours / 24);
  return `${days} ${days === 1 ? "day" : "days"} ago`;
}

function formatExactUsageLimitTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : US_USAGE_TIME_FORMATTER.format(date);
}

function resolveUsageLimitBadgeClassName(
  tone: UsageLimitPresentation["tone"]
): string {
  if (tone === "danger") {
    return "border-destructive/25 bg-destructive/10 text-destructive";
  }
  if (tone === "warning") {
    return resolveStatusToneAdvisoryBadgeClassName();
  }
  if (tone === "ready") {
    return "border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
  }
  return "text-muted-foreground";
}

export type SettingsLocalAgentAdvisoryBadgeProps = {
  detail: string;
  label: string;
  tone?: "muted" | "warning";
  updateCommand: string | null;
};

export function SettingsLocalAgentAdvisoryBadge({
  detail,
  label,
  tone = "warning",
  updateCommand,
}: SettingsLocalAgentAdvisoryBadgeProps) {
  const tooltipContent = updateCommand ? (
    <>
      <span>
        {detail} Run this command on this computer to update this controller.
      </span>
      <code className="block max-w-full overflow-x-auto whitespace-pre-wrap break-words rounded-sm border border-background/20 bg-background/10 px-2 py-1 font-mono text-[11px] text-background leading-4">
        {updateCommand}
      </code>
    </>
  ) : (
    `${detail} Update this controller from the installer or package manager used on this computer.`
  );

  const badge = (
    <Badge
      className={cn(
        tone === "warning" && resolveStatusToneAdvisoryBadgeClassName()
      )}
      variant="secondary"
    >
      {label}
    </Badge>
  );

  return (
    <Tooltip>
      <TooltipTrigger
        render={<span className="inline-flex shrink-0">{badge}</span>}
      />
      <TooltipContent
        className="max-w-sm flex-col items-start gap-2 whitespace-normal text-left"
        side="top"
      >
        {tooltipContent}
      </TooltipContent>
    </Tooltip>
  );
}

export type SettingsLocalAgentsCardProps = {
  action?: ReactNode;
  className?: string;
  description: string;
  emptyMessage?: string;
  error?: string | null;
  rows: readonly SettingsLocalAgentRow[];
  title?: string;
};

export function SettingsLocalAgentsCard({
  action,
  className,
  description,
  emptyMessage = "No supported agents on this computer yet.",
  error,
  rows,
  title = "Local agents",
}: SettingsLocalAgentsCardProps) {
  return (
    <Card className={className} data-testid="settings-local-agents-card">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <RobotIcon className="h-5 w-5" />
          {title}
        </CardTitle>
        <CardDescription>{description}</CardDescription>
        {action ? <CardAction>{action}</CardAction> : null}
      </CardHeader>
      <CardContent>
        {error ? (
          <p className="mb-3 text-destructive text-xs" role="alert">
            {error}
          </p>
        ) : null}
        {rows.length === 0 ? (
          <p className="text-muted-foreground text-sm">{emptyMessage}</p>
        ) : (
          <SettingsLocalAgentRows rows={rows} />
        )}
      </CardContent>
    </Card>
  );
}

export function SettingsLocalAgentRows({
  className,
  rows,
}: {
  className?: string;
  rows: readonly SettingsLocalAgentRow[];
}) {
  return (
    <Accordion
      className={cn("w-full divide-y divide-border", className)}
      defaultValue={resolveDefaultExpandedLocalAgentRowIds(rows)}
      multiple
    >
      {rows.map((row) => (
        <SettingsLocalAgentRowView key={row.id} row={row} />
      ))}
    </Accordion>
  );
}

function resolveDefaultExpandedLocalAgentRowIds(
  rows: readonly SettingsLocalAgentRow[]
): string[] {
  const defaultExpandedIds: string[] = [];
  for (const row of rows) {
    if (row.defaultExpanded) {
      defaultExpandedIds.push(row.id);
    }
  }
  return defaultExpandedIds;
}

function SettingsLocalAgentRowView({ row }: { row: SettingsLocalAgentRow }) {
  if (row.detail) {
    return (
      <AccordionItem
        className="w-full min-w-0"
        data-muted={row.muted ? "true" : undefined}
        data-testid={`settings-local-agent-row-${row.id}`}
        value={row.id}
      >
        <div
          className={cn(
            "grid w-full min-w-0 grid-cols-[minmax(0,1fr)_auto] items-stretch",
            row.muted ? null : "hover:bg-muted/15"
          )}
        >
          <div
            className="w-full min-w-0"
            data-testid="settings-local-agent-row-trigger"
          >
            <AccordionTrigger
              aria-label={`${row.displayName} details`}
              className="h-full min-w-0 px-4 py-4"
            >
              <SettingsLocalAgentRowSummary row={row} />
            </AccordionTrigger>
          </div>
          <SettingsLocalAgentRowControl
            className="py-4 pr-4 pl-4"
            control={row.control}
          />
        </div>
        <AccordionContent>
          <div className="border-border/70 border-t px-4 py-3">
            {row.detail}
          </div>
        </AccordionContent>
      </AccordionItem>
    );
  }

  return (
    <div
      className="grid w-full min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-4 px-4 py-4"
      data-muted={row.muted ? "true" : undefined}
      data-testid={`settings-local-agent-row-${row.id}`}
    >
      <SettingsLocalAgentRowSummary row={row} />
      <SettingsLocalAgentRowControl control={row.control} />
    </div>
  );
}

function SettingsLocalAgentRowSummary({ row }: { row: SettingsLocalAgentRow }) {
  const summaryStatuses =
    row.summaryStatuses ?? (row.summaryStatus ? [row.summaryStatus] : []);
  const summaryItems: {
    content: ReactNode;
    className: string;
    key: string;
  }[] = summaryStatuses.map((status, index) => ({
    className: resolveLocalAgentSummaryStatusClassName(status.tone),
    content: status.label,
    key: `status-${index}`,
  }));
  if (row.summaryMeta) {
    summaryItems.push({
      className: "min-w-0 truncate text-muted-foreground",
      content: row.summaryMeta,
      key: "meta",
    });
  }

  return (
    <div className="flex min-w-0 flex-1 items-start gap-4">
      <SettingsLocalAgentIcon
        agentId={row.logoAgentId ?? row.id}
        muted={row.muted === true}
      />
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <p
            className={cn(
              "truncate font-medium text-sm",
              row.muted ? "text-muted-foreground" : "text-foreground"
            )}
          >
            {row.displayName}
          </p>
          {row.badge}
          {summaryItems.length > 0 ? (
            <span className="inline-flex min-w-0 items-center gap-1 text-xs">
              {summaryItems.map((item, index) => (
                <Fragment key={item.key}>
                  {index > 0 ? (
                    <span className="shrink-0 text-muted-foreground">·</span>
                  ) : null}
                  <span className={item.className}>{item.content}</span>
                </Fragment>
              ))}
            </span>
          ) : null}
          {row.summaryAccessory}
        </div>
        {row.description ? (
          <p
            className={cn(
              "text-xs leading-5",
              row.descriptionTone === "warning"
                ? resolveStatusToneSoftTextClassName("warning")
                : "text-muted-foreground"
            )}
          >
            {row.description}
          </p>
        ) : null}
      </div>
    </div>
  );
}

function resolveLocalAgentSummaryStatusClassName(
  tone: SettingsLocalAgentRowSummaryStatus["tone"]
): string {
  return cn(
    "shrink-0 truncate font-medium",
    tone && tone !== "muted"
      ? resolveStatusToneStrongTextClassName(tone)
      : "text-muted-foreground"
  );
}

function SettingsLocalAgentRowControl({
  className,
  control,
}: {
  className?: string;
  control?: ReactNode;
}) {
  if (!control) {
    return null;
  }

  return (
    <div
      className={cn(
        "ml-auto flex shrink-0 items-center justify-end",
        className
      )}
      data-testid="settings-local-agent-row-control"
    >
      {control}
    </div>
  );
}

function SettingsLocalAgentIcon({
  agentId,
  muted,
}: {
  agentId: string;
  muted?: boolean;
}) {
  if (hasLocalAgentLogo(agentId)) {
    return (
      <span
        aria-hidden="true"
        className={cn(
          "mt-0.5 grid h-8 w-8 shrink-0 place-items-center",
          muted ? "text-muted-foreground opacity-50" : "text-foreground"
        )}
      >
        <LocalAgentLogo
          agentId={agentId}
          className="h-7 w-7"
          size="md"
          variant="plain"
        />
      </span>
    );
  }

  return (
    <span
      aria-hidden="true"
      className={cn(
        "mt-0.5 grid h-8 w-8 shrink-0 place-items-center text-muted-foreground",
        muted ? "opacity-50" : null
      )}
    >
      <RobotIcon className="h-4 w-4" />
    </span>
  );
}

function resolveStatusTextClassName(tone: SettingsComputerStatusTone): string {
  switch (tone) {
    case "connected":
      return resolveStatusToneSoftTextClassName("ready");
    case "checking":
      return resolveStatusToneSoftTextClassName("checking");
    case "warning":
      return resolveStatusToneSoftTextClassName("warning");
    case "danger":
      return "text-destructive";
    default:
      return "text-muted-foreground";
  }
}

function resolveStatusDotClassName(tone: SettingsComputerStatusTone): string {
  switch (tone) {
    case "connected":
      return resolveStatusToneIndicatorClassName("ready", "quiet");
    case "checking":
      return resolveStatusToneIndicatorClassName("checking", "quiet");
    case "warning":
      return resolveStatusToneIndicatorClassName("warning", "quiet");
    case "danger":
      return "bg-destructive";
    default:
      return "bg-muted-foreground";
  }
}
