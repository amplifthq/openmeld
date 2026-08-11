import { SettingsFieldStatusBadge } from "#components/settings-field";
import type { SettingsRowProps } from "#lib/settings-contract";
import { cn } from "#lib/utils";

/**
 * A controlled config row: label + description followed by the injected control,
 * either inline or stacked, with error copy when `status` is "error". See
 * developing/clients/shell-and-settings.md §7 layer 2. Purely presentational —
 * the per-client row owns the control + its data binding; this primitive only
 * lays it out and color-codes the autonomous-save lifecycle status.
 */
export function SettingsRow({
  label,
  description,
  status = "idle",
  layout = "inline",
  showDivider = true,
  error,
  control,
}: SettingsRowProps) {
  const showError = status === "error" && Boolean(error);
  // NOTE: SettingsRow deliberately does NOT use the implicit-<label> association
  // that SettingsField uses. A row's `control` is heterogeneous (a <button>,
  // a switch, an input) and sits beside descriptive copy; wrapping it in a
  // <label> would clobber a button's accessible name with the row's label +
  // description text and make the descriptive copy part of the control's name.
  // Per-client rows that render a labelable input should pass an already-labelled
  // control (e.g. via aria-label/aria-labelledby) into this presentational slot.
  return (
    <div
      className={cn(
        "flex flex-col py-3",
        layout === "inline"
          ? "gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-6"
          : "gap-3",
        showDivider && "border-border border-b last:border-b-0"
      )}
      data-layout={layout}
      data-slot="settings-row"
      data-status={status}
    >
      <div className="flex min-w-0 flex-col gap-0.5">
        <div className="flex items-center gap-2">
          <span className="font-medium text-foreground text-sm">{label}</span>
          <SettingsFieldStatusBadge status={status} />
        </div>
        {description ? (
          <p
            className="text-muted-foreground text-xs/relaxed"
            data-slot="settings-row-description"
          >
            {description}
          </p>
        ) : null}
        {showError ? (
          <p
            className="mt-1 text-destructive text-xs"
            data-slot="settings-row-error"
            role="alert"
          >
            {error}
          </p>
        ) : null}
      </div>
      <div
        className={cn(
          "flex items-center gap-2",
          layout === "inline" ? "shrink-0" : "w-full min-w-0 items-stretch"
        )}
        data-slot="settings-row-control"
      >
        {control}
      </div>
    </div>
  );
}
