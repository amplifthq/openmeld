"use client";

import {
  type ComponentProps,
  createContext,
  forwardRef,
  useContext,
  useId,
} from "react";
import { SidebarMenu, SidebarMenuItem } from "#fluid/sidebar-menu";
import { cn } from "#lib/utils";

type FluidNavMenuProps = ComponentProps<"nav"> & {
  activeValue: string | null;
  activeIndicatorClassName?: string;
  hoverIndicatorClassName?: string;
  focusIndicatorClassName?: string;
  /** Stable identity shared across route remounts and groups of one sidebar. */
  activeLayoutId?: string;
};
type FluidNavMenuItemProps = ComponentProps<"li"> & {
  disabled?: boolean;
  index: number;
  value: string;
};
const ActiveValueContext = createContext<string | null>(null);

/** Navigation semantics over the same interaction primitive as the main sidebar. */
const FluidNavMenu = forwardRef<HTMLElement, FluidNavMenuProps>(
  (
    {
      activeValue,
      activeLayoutId,
      activeIndicatorClassName,
      hoverIndicatorClassName,
      focusIndicatorClassName,
      children,
      className,
      ...props
    },
    ref
  ) => {
    const id = useId();
    return (
      <ActiveValueContext.Provider value={activeValue}>
        <nav
          {...props}
          className={cn("relative min-w-0 select-none", className)}
          ref={ref}
        >
          <SidebarMenu
            activeIndicatorClassName={activeIndicatorClassName}
            activeLayoutId={activeLayoutId ?? id}
            className="gap-1"
            focusIndicatorClassName={focusIndicatorClassName}
            hoverIndicatorClassName={hoverIndicatorClassName}
          >
            {children}
          </SidebarMenu>
        </nav>
      </ActiveValueContext.Provider>
    );
  }
);
FluidNavMenu.displayName = "FluidNavMenu";
const FluidNavMenuItem = forwardRef<HTMLLIElement, FluidNavMenuItemProps>(
  ({ disabled = false, index, value, className, ...props }, ref) => {
    const activeValue = useContext(ActiveValueContext);
    const isActive = !disabled && activeValue === value;
    return (
      <SidebarMenuItem
        {...props}
        aria-disabled={disabled || undefined}
        className={cn("min-w-0", className)}
        data-active={isActive || undefined}
        data-fluid-nav-index={index}
        data-fluid-nav-value={value}
        data-state={isActive ? "active" : "inactive"}
        isActive={isActive}
        ref={ref}
      />
    );
  }
);
FluidNavMenuItem.displayName = "FluidNavMenuItem";
export type { FluidNavMenuProps, FluidNavMenuItemProps };
export { FluidNavMenu, FluidNavMenuItem };
