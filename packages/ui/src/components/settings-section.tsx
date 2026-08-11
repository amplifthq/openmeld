import { SettingsFieldStatusBadge } from "#components/settings-field";
import type { SettingsSectionProps } from "#lib/settings-contract";
import { cn } from "#lib/utils";

/**
 * A Settings section — a scroll anchor inside a flat-form leaf panel (its `id`
 * is the anchor `useScrollSpy` observes), with an optional section-level status
 * and footer. See developing/clients/shell-and-settings.md §7 layer 2. Purely
 * presentational: it groups rows and owns no data. Per-card autonomous save
 * means status is section/row level, never a page-level Save.
 */
export function SettingsSection({
  id,
  title,
  description,
  className,
  status = "idle",
  children,
  action,
  footer,
}: SettingsSectionProps) {
  // `scroll-mt` gives a sticky header room when scroll-spy jumps here.
  return (
    <section
      aria-labelledby={`${id}-heading`}
      className={cn("scroll-mt-16 pt-6 pb-6", className)}
      data-slot="settings-section"
      data-status={status}
      id={id}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h2
            className="font-medium text-foreground text-sm"
            id={`${id}-heading`}
          >
            {title}
          </h2>
          {description ? (
            <p
              className="text-muted-foreground text-xs/relaxed"
              data-slot="settings-section-description"
            >
              {description}
            </p>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <SettingsFieldStatusBadge status={status} />
          {action}
        </div>
      </div>

      <div className="mt-4 flex flex-col" data-slot="settings-section-body">
        {children}
      </div>

      {footer ? (
        <div
          className="mt-4 flex items-center gap-2 border-border border-t pt-4"
          data-slot="settings-section-footer"
        >
          {footer}
        </div>
      ) : null}
    </section>
  );
}
