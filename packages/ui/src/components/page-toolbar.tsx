import type { ComponentProps } from "react";
import { cn } from "#lib/utils";

/** Shared layout for page navigation and actions; controls own their behavior. */
export function PageToolbar({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "relative flex min-h-12 shrink-0 flex-wrap items-center justify-between gap-2",
        className
      )}
      data-slot="page-toolbar"
      {...props}
    />
  );
}
