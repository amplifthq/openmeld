import type { SettingsShellProps } from "#lib/settings-contract";
import { cn } from "#lib/utils";

/**
 * The shared Settings frame (zero data) — see developing/clients/shell-and-settings.md
 * §7 layer 1. A flex row: the inner nav slot on the left, the routed panel
 * (children) on the right. Purely presentational; the nav and panel are
 * injected. The inner rail reads as the `--sidebar` surface; the panel uses the
 * recessed content background, keeping the 3-tone elevation consistent with the
 * outer rail rendered by AppFrame.
 */
export function SettingsShell({ nav, children }: SettingsShellProps) {
  return (
    <div className="flex h-full min-h-0 w-full" data-slot="settings-shell">
      <div
        className={cn(
          "flex min-h-0 w-56 shrink-0 flex-col border-border border-r bg-sidebar text-sidebar-foreground"
        )}
        data-slot="settings-shell-nav"
      >
        {nav}
      </div>
      <div
        className="min-h-0 min-w-0 flex-1 overflow-y-auto bg-background"
        data-slot="settings-shell-panel"
      >
        {children}
      </div>
    </div>
  );
}
