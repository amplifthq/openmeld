import type { MouseEvent, ReactNode } from "react";
import { FluidNavMenu, FluidNavMenuItem } from "#fluid/nav-menu";
import type {
  AppFrameProps,
  RailDestination,
  RenderRailLink,
} from "#lib/shell-contract";
import { cn } from "#lib/utils";

/**
 * True only for a plain primary click the injected link did NOT handle. Lets a
 * router Link own Cmd/Ctrl/Shift-click (open-in-new-tab) and any click it
 * `preventDefault`s, so the rail's `onNavigate` fallback never wrongly mutates
 * active state on a modified or already-handled click.
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
 * The single app frame that composes every top-level view via named slots — see
 * developing/clients/shell-and-settings.md §5. Purely presentational: navigation
 * is injected through `onNavigate` / `renderRailLink`, never imported. The live
 * Web shell now uses one continuous `bg-background` surface; borders provide the
 * rail/list/content separation without creating a nested slab effect.
 */

const OUTER_RAIL_WIDTH = "w-14";
const EXPANDED_OUTER_RAIL_WIDTH = "w-44";

/** Default renderer: a plain button. Web overrides with a router Link; Desktop
 * keeps this button and navigates by id. Either way `onNavigate` is the
 * fallback so the rail is usable with zero host wiring. */
function defaultRenderRailLink(
  destination: RailDestination,
  children: ReactNode,
  isActive: boolean,
  railMode: "icon" | "expanded",
  onActivate: () => void
): ReactNode {
  const expanded = railMode === "expanded";

  return (
    <button
      aria-current={isActive ? "page" : undefined}
      aria-label={expanded ? undefined : destination.label}
      className={cn(
        "flex rounded-md text-muted-foreground outline-none transition-colors",
        expanded
          ? "h-10 w-full min-w-0 items-center gap-2 px-2 text-left text-sm"
          : "size-10 items-center justify-center",
        "hover:text-foreground focus-visible:text-foreground",
        isActive && "text-foreground"
      )}
      data-active={isActive || undefined}
      onClick={onActivate}
      title={destination.label}
      type="button"
    >
      {children}
    </button>
  );
}

function RailLink({
  destination,
  isActive,
  onNavigate,
  railMode,
  renderRailLink,
}: {
  destination: RailDestination;
  isActive: boolean;
  onNavigate: (id: string) => void;
  railMode: "icon" | "expanded";
  renderRailLink?: RenderRailLink;
}) {
  const label =
    railMode === "expanded" ? (
      <span className="flex min-w-0 items-center gap-2">
        {destination.icon ? (
          <span className="flex size-4 shrink-0 items-center justify-center">
            {destination.icon}
          </span>
        ) : null}
        <span className="min-w-0 truncate">{destination.label}</span>
      </span>
    ) : (
      (destination.icon ?? destination.label)
    );
  const onActivate = () => onNavigate(destination.id);

  // When the host injects a renderer (e.g. a router Link) we wrap it so the
  // injected node owns navigation; we still call onNavigate as the fallback for
  // hosts (Desktop) whose link is non-navigating. The host renderer decides the
  // element; we provide the accessible content + active marker via a wrapper.
  // The bubble-phase handler only fires the fallback for a plain primary click
  // the link did not handle — so a router Link keeps Cmd/Ctrl/Shift-click.
  if (renderRailLink) {
    return (
      // biome-ignore lint/a11y/noStaticElementInteractions: the injected child (a router Link/button) is the real interactive element and owns keyboard semantics; this wrapper only relays a plain primary click to the onNavigate fallback.
      // biome-ignore lint/a11y/noNoninteractiveElementInteractions: same — the wrapper is a transparent click relay around an injected interactive link, not an interactive element itself.
      // biome-ignore lint/a11y/useKeyWithClickEvents: keyboard activation is handled by the injected interactive link; this relay must not double-bind keyboard handlers.
      <span
        aria-current={isActive ? "page" : undefined}
        className={cn(
          "flex items-center justify-center [&>*]:flex [&>*]:rounded-md [&>*]:text-muted-foreground [&>*]:transition-colors focus-within:[&>*]:text-foreground hover:[&>*]:text-foreground",
          railMode === "expanded"
            ? "w-full [&>*]:h-10 [&>*]:w-full [&>*]:min-w-0 [&>*]:items-center [&>*]:gap-2 [&>*]:px-2 [&>*]:text-sm"
            : "size-10 [&>*]:size-10 [&>*]:items-center [&>*]:justify-center",
          isActive && "[&>*]:text-foreground"
        )}
        data-active={isActive || undefined}
        onClick={(event) => {
          if (isPlainUnhandledClick(event)) {
            onActivate();
          }
        }}
      >
        {renderRailLink(destination, label)}
      </span>
    );
  }

  return defaultRenderRailLink(
    destination,
    label,
    isActive,
    railMode,
    onActivate
  );
}

export function AppFrame({
  destinations,
  activeDestinationId,
  onNavigate,
  renderRailLink,
  railMode = "icon",
  railHeader,
  brand,
  account,
  railList,
  header,
  content,
  aside,
}: AppFrameProps) {
  const expandedRail = railMode === "expanded";
  let railHeaderSlot: ReactNode = null;

  if (railHeader) {
    railHeaderSlot = <div data-slot="app-frame-rail-header">{railHeader}</div>;
  } else if (brand) {
    railHeaderSlot = (
      <div
        className={cn(
          "flex w-full items-center",
          expandedRail
            ? "h-[var(--space-conversation-header-height)] justify-start px-3"
            : "h-10 justify-center"
        )}
        data-slot="app-frame-brand"
      >
        {brand}
      </div>
    );
  }

  return (
    <div
      className="flex h-full min-h-0 w-full bg-background text-foreground"
      data-slot="app-frame"
    >
      {/* Outer rail — persistent destination switcher (brand · destinations · account). */}
      <div
        className={cn(
          "flex shrink-0 flex-col border-border border-r bg-background",
          expandedRail ? EXPANDED_OUTER_RAIL_WIDTH : OUTER_RAIL_WIDTH,
          expandedRail ? "items-stretch" : "items-center gap-2 py-3"
        )}
        data-slot="app-frame-rail"
      >
        {railHeaderSlot}

        <FluidNavMenu
          activeIndicatorClassName="bg-surface-6"
          activeValue={activeDestinationId}
          aria-label="Primary"
          className={cn(
            "min-h-0 flex-1",
            expandedRail ? "w-full [&>ul]:px-2 [&>ul]:py-3" : "w-full"
          )}
          data-slot="app-frame-destinations"
          focusIndicatorClassName="border-sidebar-ring"
          hoverIndicatorClassName="bg-surface-5"
        >
          {destinations.map((destination, index) => (
            <FluidNavMenuItem
              className={expandedRail ? "w-full" : "mx-auto size-10"}
              data-slot="app-frame-rail-item"
              index={index}
              key={destination.id}
              value={destination.id}
            >
              <RailLink
                destination={destination}
                isActive={destination.id === activeDestinationId}
                onNavigate={onNavigate}
                railMode={railMode}
                renderRailLink={renderRailLink}
              />
            </FluidNavMenuItem>
          ))}
        </FluidNavMenu>

        {account ? (
          <div
            className={cn(
              "mt-auto flex w-full",
              expandedRail
                ? "border-border border-t p-2"
                : "h-10 items-center justify-center"
            )}
            data-slot="app-frame-account"
          >
            {account}
          </div>
        ) : null}
      </div>

      {/* Optional inner secondary rail — the resizable list (spaces / settings nav). */}
      {railList ? (
        <div
          className="flex min-h-0 shrink-0 flex-col border-border border-r bg-background text-sidebar-foreground"
          data-slot="app-frame-rail-list"
        >
          {railList}
        </div>
      ) : null}

      {/* Content column — optional sticky header + required scrollable content. */}
      <div
        className="flex min-h-0 min-w-0 flex-1 flex-col bg-background"
        data-slot="app-frame-main"
      >
        {header ? (
          <header
            className="h-[var(--space-conversation-header-height)] shrink-0 overflow-hidden border-border border-b"
            data-slot="app-frame-header"
          >
            {header}
          </header>
        ) : null}
        <main
          className="min-h-0 min-w-0 flex-1 overflow-y-auto"
          data-slot="app-frame-content"
        >
          {content}
        </main>
      </div>

      {/* Optional right drawer (Space members panel). */}
      {aside ? (
        <aside
          className="flex min-h-0 shrink-0 flex-col border-border border-l bg-background text-sidebar-foreground"
          data-slot="app-frame-aside"
        >
          {aside}
        </aside>
      ) : null}
    </div>
  );
}
