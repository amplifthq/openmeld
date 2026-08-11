import type {
  SettingsFieldProps,
  SettingsFieldStatus,
} from "#lib/settings-contract";
import { cn } from "#lib/utils";

/**
 * A single controlled config field (the atom of the Settings framework — see
 * developing/clients/shell-and-settings.md §7 layer 2). Purely presentational:
 * it owns NO data and NO mutation; the per-client row drives `status` and
 * supplies the control as `children`. The lifecycle status is color-coded and
 * announced for assistive tech; error copy renders under the control.
 */

const STATUS_LABELS: Record<SettingsFieldStatus, string> = {
  idle: "",
  dirty: "Unsaved changes",
  saving: "Saving…",
  saved: "Saved",
  error: "Couldn't save",
};

/** Color-coded status text classes — color is the only signal that varies. */
const STATUS_TEXT_CLASS: Record<SettingsFieldStatus, string> = {
  idle: "text-muted-foreground",
  dirty: "text-muted-foreground",
  saving: "text-muted-foreground",
  saved: "text-foreground",
  error: "text-destructive",
};

/** A small status dot color per lifecycle state. */
const STATUS_DOT_CLASS: Record<SettingsFieldStatus, string> = {
  idle: "bg-transparent",
  dirty: "bg-muted-foreground",
  saving: "bg-muted-foreground",
  saved: "bg-foreground",
  error: "bg-destructive",
};

export function settingsFieldStatusLabel(status: SettingsFieldStatus): string {
  return STATUS_LABELS[status];
}

export function SettingsFieldStatusBadge({
  status,
}: {
  status: SettingsFieldStatus;
}) {
  if (status === "idle") {
    return null;
  }
  const label = STATUS_LABELS[status];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 text-xs",
        STATUS_TEXT_CLASS[status]
      )}
      data-slot="settings-field-status"
      data-status={status}
    >
      <span
        aria-hidden="true"
        className={cn(
          "size-1.5 rounded-md",
          STATUS_DOT_CLASS[status],
          status === "saving" && "animate-pulse"
        )}
      />
      <span>{label}</span>
    </span>
  );
}

export function SettingsField({
  label,
  status = "idle",
  error,
  children,
}: SettingsFieldProps) {
  const showError = status === "error" && Boolean(error);
  const control = (
    <div
      className={cn(
        "rounded-md transition-colors",
        status === "error" && "[&_input]:border-destructive"
      )}
      data-slot="settings-field-control"
    >
      {children}
    </div>
  );
  return (
    <div
      className="flex flex-col gap-1.5"
      data-slot="settings-field"
      data-status={status}
    >
      {label ? (
        // The native <label> implicitly associates the visible label text with
        // the control rendered as injected `children`, giving an injected
        // control its accessible name. The status badge stays on the header row
        // alongside the label text. biome can't see the control statically (it
        // arrives as `children` inside the `{control}` wrapper), so the
        // implicit association is suppressed here.
        // biome-ignore lint/a11y/noLabelWithoutControl: the control is injected as `children` inside this label (implicit association); biome cannot resolve it through the `{control}` expression.
        <label className="flex flex-col gap-1.5">
          <span className="flex items-center justify-between gap-2">
            <span className="font-medium text-foreground text-xs">{label}</span>
            <SettingsFieldStatusBadge status={status} />
          </span>
          {control}
        </label>
      ) : (
        control
      )}
      {showError ? (
        <p
          className="text-destructive text-xs"
          data-slot="settings-field-error"
          role="alert"
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}
