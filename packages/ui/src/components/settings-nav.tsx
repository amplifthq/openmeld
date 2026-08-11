import type { MouseEvent, ReactNode } from "react";
import { FluidNavMenu, FluidNavMenuItem } from "#fluid/nav-menu";
import type {
  RenderSettingsLink,
  SettingsNavProps,
} from "#lib/settings-contract";
import { cn } from "#lib/utils";

/**
 * True only for a plain primary click the injected link did NOT handle — so a
 * router Link keeps Cmd/Ctrl/Shift-click (open-in-new-tab) and any click it
 * `preventDefault`s, while the controlled `activeSectionId` fallback still
 * updates on a normal click.
 */
function isPlainUnhandledClick(event: MouseEvent): boolean {
  return !(
    event.defaultPrevented ||
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey
  );
}

/**
 * The inner Settings rail — a thin nav over the Settings routes (Account /
 * Computers / Agents / Service). See developing/clients/shell-and-settings.md §7.
 * Purely presentational: navigation is injected via `renderLink` / `onNavigate`;
 * this component imports no router. It reuses `FluidNavMenu`'s animated active
 * indicator (the highlight slides between items) driven by `activeSectionId`.
 *
 * The default item renderer is a plain button (Desktop). Web injects a router
 * Link through `renderLink`; in both cases `onNavigate` is still invoked so the
 * controlled `activeSectionId` updates even when the injected link is inert.
 */

function defaultRenderSettingsLink(
  children: ReactNode,
  isActive: boolean,
  onActivate: () => void
): ReactNode {
  return (
    <button
      aria-current={isActive ? "page" : undefined}
      className={cn(
        "flex min-h-10 w-full items-center rounded-md px-2 text-left font-medium text-muted-foreground text-sm outline-none transition-colors",
        "hover:text-foreground focus-visible:text-foreground",
        isActive && "text-foreground"
      )}
      data-active={isActive || undefined}
      onClick={onActivate}
      type="button"
    >
      {children}
    </button>
  );
}

export function SettingsNav({
  items,
  activeSectionId,
  onNavigate,
  renderLink,
}: SettingsNavProps & { renderLink?: RenderSettingsLink }) {
  return (
    <FluidNavMenu
      activeIndicatorClassName="bg-surface-6"
      activeValue={activeSectionId}
      aria-label="Settings sections"
      className="w-full"
      data-slot="settings-nav"
      focusIndicatorClassName="border-sidebar-ring"
      hoverIndicatorClassName="bg-surface-5"
    >
      {items.map((item, index) => {
        const isActive = item.id === activeSectionId;
        const onActivate = () => onNavigate(item.id);
        const content = renderLink
          ? renderLink(item, item.title)
          : defaultRenderSettingsLink(item.title, isActive, onActivate);
        return (
          <FluidNavMenuItem index={index} key={item.id} value={item.id}>
            {/* When a host renderer is injected we relay a plain primary click
             * so the controlled active id updates (the injected link may be
             * inert), but skip modified/handled clicks so a router Link keeps
             * Cmd/Ctrl/Shift-click. */}
            {renderLink ? (
              // biome-ignore lint/a11y/noStaticElementInteractions: the injected child (a router Link/button) is the real interactive element and owns keyboard semantics; this wrapper only relays a plain primary click to the onNavigate fallback.
              // biome-ignore lint/a11y/noNoninteractiveElementInteractions: same — the wrapper is a transparent click relay around an injected interactive link, not an interactive element itself.
              // biome-ignore lint/a11y/useKeyWithClickEvents: keyboard activation is handled by the injected interactive link; this relay must not double-bind keyboard handlers.
              <span
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  "flex w-full [&>*]:flex [&>*]:min-h-10 [&>*]:w-full [&>*]:items-center [&>*]:rounded-md [&>*]:px-2 [&>*]:text-left [&>*]:font-medium [&>*]:text-muted-foreground [&>*]:text-sm hover:[&>*]:text-foreground",
                  isActive && "[&>*]:text-foreground"
                )}
                data-active={isActive || undefined}
                onClick={(event) => {
                  if (isPlainUnhandledClick(event)) {
                    onActivate();
                  }
                }}
              >
                {content}
              </span>
            ) : (
              content
            )}
          </FluidNavMenuItem>
        );
      })}
    </FluidNavMenu>
  );
}
