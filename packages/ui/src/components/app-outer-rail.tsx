"use client";

import { SidebarSimpleIcon } from "@phosphor-icons/react";
import {
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useEffectEvent,
} from "react";
import { OpenMeldLetterLogoStrong } from "#components/openmeld-letter-logo-strong";
import { OpenMeldLogoWeak } from "#components/openmeld-logo-weak";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
} from "#components/sidebar";
import {
  Tooltip,
  TooltipContent,
  TooltipHint,
  TooltipTrigger,
} from "#components/tooltip";
import { FluidNavMenu, FluidNavMenuItem } from "#fluid/nav-menu";
import { cn } from "#lib/utils";

export type AppOuterRailDestination = {
  icon: ReactNode;
  id: string;
  label: string;
  to?: string;
};

export type AppOuterRailAccount = {
  description?: string | null;
  fallback?: string | null;
  image?: string | null;
  label?: string | null;
};

export type AppOuterRailLinkRenderArgs = {
  ariaCurrent?: "page";
  ariaLabel?: string;
  children: ReactNode;
  className: string;
  destination: AppOuterRailDestination;
  onClick: (event: ReactMouseEvent) => void;
  onPointerDown: (event: ReactPointerEvent) => void;
  title?: string;
};

export type AppOuterRailBrandRenderArgs = {
  ariaLabel: string;
  children: ReactNode;
  className: string;
  collapsed: boolean;
};

export type AppOuterRailAccountRenderArgs = {
  ariaCurrent?: "page";
  ariaLabel?: string;
  children: ReactNode;
  className: string;
  collapsed: boolean;
  onClick: (event: ReactMouseEvent) => void;
  title?: string;
};

type ResolvedAccountRailDisplay = {
  description: string | null;
  displayName: string;
  fallback: string;
  image?: string | null;
};

export type AppOuterRailProps = {
  account?: AppOuterRailAccount | null;
  accountActive?: boolean;
  activeDestinationId: string;
  className?: string;
  collapsed: boolean;
  collapsedBrand?: ReactNode;
  collapsedWidth?: string;
  destinations: readonly AppOuterRailDestination[];
  expandedBrand?: ReactNode;
  maxWidth?: string;
  minWidth?: string;
  onAccountNavigate?: () => void;
  onBrandNavigate?: () => void;
  onCollapsedChange: (collapsed: boolean) => void;
  onNavigate: (destinationId: string) => void;
  onWidthChange?: (width: string) => void;
  renderAccountLink?: (args: AppOuterRailAccountRenderArgs) => ReactNode;
  renderBrandLink?: (args: AppOuterRailBrandRenderArgs) => ReactNode;
  renderDestinationLink?: (args: AppOuterRailLinkRenderArgs) => ReactNode;
  resizeRail?: boolean;
  resizeRailLabel?: string;
  sidebarSlot?: string;
  testId?: string;
  toggleShortcutKey?: string | null;
  width?: string;
};

const DEFAULT_COLLAPSED_WIDTH = "3.25rem";
const DEFAULT_WIDTH = "9rem";
const DEFAULT_MIN_WIDTH = "7rem";
const DEFAULT_MAX_WIDTH = "11rem";

export function AppOuterRail({
  account,
  accountActive = false,
  activeDestinationId,
  className,
  collapsed,
  collapsedBrand,
  collapsedWidth = DEFAULT_COLLAPSED_WIDTH,
  destinations,
  expandedBrand,
  maxWidth = DEFAULT_MAX_WIDTH,
  minWidth = DEFAULT_MIN_WIDTH,
  onAccountNavigate,
  onBrandNavigate,
  onCollapsedChange,
  onNavigate,
  onWidthChange,
  renderAccountLink,
  renderBrandLink,
  renderDestinationLink,
  resizeRail = false,
  resizeRailLabel = "Resize app rail",
  sidebarSlot = "app-outer-rail",
  testId = "app-outer-rail",
  toggleShortcutKey = "b",
  width = DEFAULT_WIDTH,
}: AppOuterRailProps) {
  const toggleCollapsed = useEffectEvent(() => {
    onCollapsedChange(!collapsed);
  });

  useEffect(() => {
    if (!toggleShortcutKey) {
      return;
    }

    const normalizedKey = toggleShortcutKey.toLowerCase();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        event.key.toLowerCase() === normalizedKey &&
        (event.metaKey || event.ctrlKey)
      ) {
        event.preventDefault();
        toggleCollapsed();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [toggleShortcutKey]);

  return (
    <SidebarProvider
      collapsedWidth={collapsedWidth}
      maxWidth={maxWidth}
      minWidth={minWidth}
      onOpenChange={(open) => onCollapsedChange(!open)}
      onWidthChange={onWidthChange}
      open={!collapsed}
      side="left"
      width={width}
    >
      <Sidebar
        className={cn(
          "border-r bg-background text-sidebar-foreground",
          className
        )}
        data-slot={sidebarSlot}
        data-testid={testId}
      >
        <SidebarHeader className="h-[var(--space-conversation-header-height)] justify-center gap-2 overflow-hidden border-border border-b px-2 py-0">
          <AppRailBrand
            collapsed={collapsed}
            collapsedBrand={collapsedBrand}
            expandedBrand={expandedBrand}
            onBrandNavigate={onBrandNavigate}
            renderBrandLink={renderBrandLink}
          />
        </SidebarHeader>

        <SidebarContent className="overflow-hidden px-2 py-3">
          {collapsed ? (
            <div className="mb-3 flex justify-center">
              <AppRailTrigger />
            </div>
          ) : null}
          <FluidNavMenu
            activeValue={activeDestinationId}
            aria-label="App sections"
          >
            {destinations.map((destination, index) => (
              <AppRailLink
                active={destination.id === activeDestinationId}
                collapsed={collapsed}
                destination={destination}
                index={index}
                key={destination.id}
                onNavigate={onNavigate}
                renderDestinationLink={renderDestinationLink}
              />
            ))}
          </FluidNavMenu>
        </SidebarContent>

        {account ? (
          <SidebarFooter className="border-border border-t p-2">
            <AccountRailLink
              account={account}
              active={accountActive}
              collapsed={collapsed}
              onAccountNavigate={onAccountNavigate}
              renderAccountLink={renderAccountLink}
            />
          </SidebarFooter>
        ) : null}
        {resizeRail ? (
          <SidebarRail autoCollapse separatorLabel={resizeRailLabel} />
        ) : null}
      </Sidebar>
    </SidebarProvider>
  );
}

function AppRailBrand({
  collapsed,
  collapsedBrand,
  expandedBrand,
  onBrandNavigate,
  renderBrandLink,
}: {
  collapsed: boolean;
  collapsedBrand?: ReactNode;
  expandedBrand?: ReactNode;
  onBrandNavigate?: () => void;
  renderBrandLink?: (args: AppOuterRailBrandRenderArgs) => ReactNode;
}) {
  if (collapsed) {
    const children = collapsedBrand ?? (
      <OpenMeldLetterLogoStrong
        ariaLabel={null}
        pointerTracking="viewport"
        scale={0.28}
      />
    );
    const className =
      "flex size-8 items-center justify-center border border-transparent text-foreground outline-none transition-colors hover:text-foreground focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/50";

    return (
      <div className="flex h-full min-w-0 items-center justify-center">
        {renderBrandLink ? (
          renderBrandLink({
            ariaLabel: "Go Home",
            children,
            className,
            collapsed,
          })
        ) : (
          <button
            aria-label="Go Home"
            className={className}
            onClick={onBrandNavigate}
            type="button"
          >
            {children}
          </button>
        )}
      </div>
    );
  }

  const children = expandedBrand ?? (
    <OpenMeldLogoWeak className="shrink-0" scale={0.16} />
  );
  const className =
    "flex min-w-0 items-center overflow-hidden border border-transparent text-muted-foreground outline-none transition-colors hover:text-sidebar-accent-foreground focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/50";

  return (
    <div className="flex min-w-0 items-center justify-between gap-2 pl-1">
      {renderBrandLink ? (
        renderBrandLink({
          ariaLabel: "Go Home",
          children,
          className,
          collapsed,
        })
      ) : (
        <button
          aria-label="Go Home"
          className={className}
          onClick={onBrandNavigate}
          type="button"
        >
          {children}
        </button>
      )}
      <AppRailTrigger />
    </div>
  );
}

function AppRailTrigger() {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <SidebarTrigger
            aria-label="Toggle Sidebar"
            className="relative z-10 size-7 bg-background text-muted-foreground hover:bg-background hover:text-sidebar-foreground aria-expanded:bg-background aria-expanded:text-muted-foreground dark:hover:bg-background"
            size="icon-sm"
            type="button"
            variant="ghost"
          >
            <SidebarSimpleIcon className="size-4" />
          </SidebarTrigger>
        }
      />
      <TooltipContent side="right">
        <span>Toggle Sidebar</span>
        <kbd data-slot="kbd">⌘+B</kbd>
      </TooltipContent>
    </Tooltip>
  );
}

function AppRailLink({
  active,
  collapsed,
  destination,
  index,
  onNavigate,
  renderDestinationLink,
}: {
  active: boolean;
  collapsed: boolean;
  destination: AppOuterRailDestination;
  index: number;
  onNavigate: (destinationId: string) => void;
  renderDestinationLink?: (args: AppOuterRailLinkRenderArgs) => ReactNode;
}) {
  const children = (
    <>
      <span className="flex size-4 shrink-0 items-center justify-center">
        {destination.icon}
      </span>
      {collapsed ? null : <span className="truncate">{destination.label}</span>}
    </>
  );
  const className = cn(
    "flex min-w-0 items-center border border-transparent text-muted-foreground text-sm outline-none transition-colors hover:text-sidebar-accent-foreground focus-visible:text-sidebar-accent-foreground",
    collapsed ? "size-9 justify-center px-0" : "h-9 gap-2 px-2",
    active && "text-sidebar-accent-foreground"
  );
  const onActivate = () => onNavigate(destination.id);
  const handlePointerDown = (event: ReactPointerEvent) => {
    if (!isPlainPrimaryPointer(event)) {
      return;
    }
    onActivate();
  };
  const handleClick = (event: ReactMouseEvent) => {
    if (!isPlainUnhandledClick(event)) {
      return;
    }
    onActivate();
  };

  return (
    <FluidNavMenuItem
      className={collapsed ? "mx-auto size-9" : undefined}
      index={index}
      value={destination.id}
    >
      {renderDestinationLink ? (
        renderDestinationLink({
          ariaCurrent: active ? "page" : undefined,
          ariaLabel: collapsed ? destination.label : undefined,
          children,
          className,
          destination,
          onClick: handleClick,
          onPointerDown: handlePointerDown,
          title: collapsed ? destination.label : undefined,
        })
      ) : (
        <TooltipHint content={collapsed ? destination.label : undefined}>
          <button
            aria-current={active ? "page" : undefined}
            aria-label={collapsed ? destination.label : undefined}
            className={className}
            onClick={onActivate}
            type="button"
          >
            {children}
          </button>
        </TooltipHint>
      )}
    </FluidNavMenuItem>
  );
}

function AccountRailLink({
  account,
  active,
  collapsed,
  onAccountNavigate,
  renderAccountLink,
}: {
  account: AppOuterRailAccount;
  active: boolean;
  collapsed: boolean;
  onAccountNavigate?: () => void;
  renderAccountLink?: (args: AppOuterRailAccountRenderArgs) => ReactNode;
}) {
  const display = resolveAccountRailDisplay(account);
  const className = cn(
    "flex h-10 min-w-0 items-center border border-transparent text-muted-foreground outline-none transition-colors hover:text-sidebar-accent-foreground focus-visible:text-sidebar-accent-foreground",
    collapsed ? "mx-auto justify-center px-0" : "gap-2 px-2",
    active && "text-sidebar-accent-foreground"
  );
  const children = (
    <>
      <AccountRailAvatar display={display} />
      {collapsed ? null : <AccountRailText display={display} />}
    </>
  );
  const handleClick = (event: ReactMouseEvent) => {
    if (!isPlainUnhandledClick(event)) {
      return;
    }
    onAccountNavigate?.();
  };

  if (renderAccountLink) {
    return renderAccountLink({
      ariaCurrent: active ? "page" : undefined,
      ariaLabel: collapsed ? "Account settings" : undefined,
      children,
      className,
      collapsed,
      onClick: handleClick,
      title: collapsed ? "Account settings" : undefined,
    });
  }

  return (
    <TooltipHint content={collapsed ? "Account settings" : undefined}>
      <button
        aria-current={active ? "page" : undefined}
        aria-label={collapsed ? "Account settings" : undefined}
        className={className}
        onClick={handleClick}
        type="button"
      >
        {children}
      </button>
    </TooltipHint>
  );
}

function AccountRailAvatar({
  display,
}: {
  display: ResolvedAccountRailDisplay;
}) {
  return (
    <span
      aria-hidden="true"
      className="flex size-7 shrink-0 items-center justify-center border border-border bg-background text-foreground text-xs"
      style={
        display.image
          ? {
              backgroundImage: `url(${display.image})`,
              backgroundPosition: "center",
              backgroundSize: "cover",
            }
          : undefined
      }
    >
      {display.image ? null : display.fallback}
    </span>
  );
}

function AccountRailText({ display }: { display: ResolvedAccountRailDisplay }) {
  return (
    <span className="grid min-w-0 flex-1 text-left leading-tight">
      <span className="truncate font-medium text-sm">
        {display.displayName}
      </span>
      {display.description ? (
        <span className="truncate text-muted-foreground text-xs">
          {display.description}
        </span>
      ) : null}
    </span>
  );
}

function resolveAccountRailDisplay(
  account: AppOuterRailAccount
): ResolvedAccountRailDisplay {
  const displayName =
    account.label?.trim() || account.description?.trim() || "Account";
  const description =
    account.description?.trim() && account.description.trim() !== displayName
      ? account.description.trim()
      : null;

  return {
    description,
    displayName,
    fallback: account.fallback?.trim() || resolveAccountFallback(displayName),
    image: account.image,
  };
}

function isPlainUnhandledClick(event: ReactMouseEvent): boolean {
  return !(
    event.defaultPrevented ||
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey
  );
}

function isPlainPrimaryPointer(event: ReactPointerEvent): boolean {
  return !(
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey
  );
}

function resolveAccountFallback(displayName: string): string {
  const trimmed = displayName.trim();
  return (trimmed[0] ?? "A").toUpperCase();
}
