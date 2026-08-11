import type { ReactNode } from "react";
import { OpenMeldLogo } from "./openmeld-logo";

type WindowShellProps = {
  actions?: ReactNode;
  children: ReactNode;
  variant?: "compact" | "app";
};

/**
 * The main app frame: a slim brand header (logo on the left, global action
 * toolbar on the right) + a centered content column.
 */
export function WindowShell({
  actions,
  children,
  variant = "compact",
}: WindowShellProps) {
  if (variant === "app") {
    return (
      <div
        className="flex h-screen flex-col bg-background text-foreground"
        data-slot="window-shell"
        data-variant={variant}
      >
        <main
          className="flex min-h-0 w-full flex-1 overflow-hidden"
          data-slot="window-shell-main"
        >
          {children}
        </main>
      </div>
    );
  }

  return (
    <div
      className="flex min-h-screen flex-col bg-background text-foreground"
      data-slot="window-shell"
      data-variant={variant}
    >
      <header
        className="drag-region flex items-center justify-between gap-3 px-5 pt-10 pb-3"
        data-slot="window-shell-header"
      >
        {/* Same wordmark as the splash, just scaled down. */}
        <OpenMeldLogo className="text-foreground" size={8} />
        {actions ? (
          <div className="no-drag flex items-center gap-1">{actions}</div>
        ) : null}
      </header>
      <main
        className="mx-auto flex w-full max-w-lg flex-1 flex-col px-6 pt-2 pb-8"
        data-slot="window-shell-main"
      >
        {children}
      </main>
    </div>
  );
}
