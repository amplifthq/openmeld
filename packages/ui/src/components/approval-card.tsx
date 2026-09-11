"use client";

// Adapted from AICSS Approval Card (MIT), installed from its registry on
// September 10, 2026. See THIRD_PARTY_NOTICES.md. Product owners provide forms
// and explicit actions; this primitive never advances or approves a request.
import type { ComponentProps, ReactNode } from "react";
import { ScrollArea } from "#fluid/scroll-area";
import { cn } from "#lib/utils";

export function ApprovalCard({
  className,
  ...props
}: ComponentProps<"section">) {
  return (
    <section
      {...props}
      className={cn(
        "flex w-full min-w-0 flex-col gap-3 rounded-2xl border border-border bg-card p-3 text-left text-card-foreground",
        className
      )}
      data-slot="approval-card"
    />
  );
}

export function ApprovalCardHeader({
  icon,
  title,
  description,
}: {
  icon: ReactNode;
  title: string;
  description: string;
}) {
  return (
    <header className="flex min-w-0 items-start gap-2.5">
      <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-md bg-muted text-foreground [&>svg]:size-4">
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-muted-foreground text-xs">{description}</p>
        <h3 className="break-words font-medium text-sm leading-6">{title}</h3>
      </div>
    </header>
  );
}

export function ApprovalCardBody({
  children,
  className,
  ...props
}: ComponentProps<typeof ScrollArea>) {
  return (
    <ScrollArea
      {...props}
      className={cn("max-h-[min(32dvh,20rem)]", className)}
      contentClassName="grid min-w-0 gap-3 px-1 py-1"
      viewportProps={{ "aria-label": "Request details", tabIndex: 0 }}
    >
      {children}
    </ScrollArea>
  );
}

export function ApprovalCardFooter({
  className,
  ...props
}: ComponentProps<"div">) {
  return (
    <div
      {...props}
      className={cn(
        "flex shrink-0 flex-wrap items-center justify-end gap-2 [&_button]:h-8 [&_button]:text-sm",
        className
      )}
      data-slot="approval-card-footer"
    />
  );
}
