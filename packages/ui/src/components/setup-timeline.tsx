import { CheckCircleIcon, WarningCircleIcon } from "@phosphor-icons/react";
import type { ReactNode } from "react";
import { Bars } from "#components/bars";
import { cn } from "#lib/utils";

export type SetupTimelineStepState =
  | "active"
  | "blocked"
  | "complete"
  | "pending"
  | "terminal_disconnected"
  | "waiting_for_user";

export type SetupTimelineStepProps = {
  action?: ReactNode;
  children?: ReactNode;
  className?: string;
  state: SetupTimelineStepState;
  summary: string;
  title: string;
};

export function SetupTimeline({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("grid gap-5", className)} data-slot="setup-timeline">
      {children}
    </div>
  );
}

export function SetupTimelineStep({
  action,
  children,
  className,
  state,
  summary,
  title,
}: SetupTimelineStepProps) {
  const isPending = state === "pending";
  const isDestructive =
    state === "blocked" || state === "terminal_disconnected";
  let titleClassName = "text-foreground";
  if (isPending) {
    titleClassName = "text-muted-foreground";
  }
  if (isDestructive) {
    titleClassName = "text-destructive";
  }
  const summaryClassName = isDestructive
    ? "text-destructive"
    : "text-muted-foreground";

  return (
    <div
      className={cn("grid grid-cols-[1.5rem_minmax(0,1fr)] gap-x-3", className)}
      data-slot="setup-timeline-step"
      data-state={state}
    >
      <div className="flex justify-center pt-0.5">
        <SetupTimelineStepIcon state={state} />
      </div>
      <div className="min-w-0">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className={cn("font-medium text-sm", titleClassName)}>
              {title}
            </h2>
            <p className={cn("text-sm", summaryClassName)}>{summary}</p>
          </div>
          {action ? <div className="shrink-0">{action}</div> : null}
        </div>
        {children ? <div className="grid gap-4 pt-4">{children}</div> : null}
      </div>
    </div>
  );
}

function SetupTimelineStepIcon({ state }: { state: SetupTimelineStepState }) {
  if (state === "complete") {
    return (
      <CheckCircleIcon
        aria-hidden="true"
        className="size-4 text-foreground"
        weight="fill"
      />
    );
  }

  if (state === "blocked" || state === "terminal_disconnected") {
    return (
      <WarningCircleIcon
        aria-hidden="true"
        className="size-4 text-destructive"
        weight="fill"
      />
    );
  }

  if (state === "active" || state === "waiting_for_user") {
    return <Bars aria-hidden="true" className="mt-1 h-3 w-5 text-foreground" />;
  }

  return (
    <span
      aria-hidden="true"
      className="mt-1 size-3 rounded-full border border-muted-foreground/50"
    />
  );
}
