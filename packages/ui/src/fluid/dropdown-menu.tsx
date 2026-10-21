"use client";

import type * as React from "react";
import {
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioItem,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "#components/dropdown-menu";
import { FluidActionList, FluidActionListItem } from "#fluid/action-list";
import type { UseFluidHoverOptions } from "#hooks/use-fluid-hover";
import { cn } from "#lib/utils";

type FluidDropdownMenuContentProps = React.ComponentProps<
  typeof DropdownMenuContent
> & { gapClick?: UseFluidHoverOptions["gapClick"] };

type FluidDropdownMenuItemProps = Omit<
  React.ComponentProps<typeof DropdownMenuItem>,
  "nativeButton" | "render"
> & {
  index: number;
};

type FluidDropdownMenuRadioItemProps = Omit<
  React.ComponentProps<typeof DropdownMenuRadioItem>,
  "nativeButton" | "render"
> & {
  index: number;
};

/** A separate highlight for alternatives on one side of a semantic divider. */
function FluidDropdownMenuGroup({ children }: { children: React.ReactNode }) {
  return (
    <FluidActionList
      className="max-w-none"
      hoverIndicatorClassName="bg-interaction-hover"
      role="presentation"
    >
      {children}
    </FluidActionList>
  );
}

function FluidDropdownMenuContent({
  children,
  className,
  gapClick,
  ...props
}: FluidDropdownMenuContentProps) {
  return (
    <DropdownMenuContent
      {...props}
      className={cn(
        "motion-reduce:animate-none! motion-reduce:transition-none!",
        className
      )}
    >
      <FluidActionList
        className="-m-1 max-w-none p-1"
        gapClick={gapClick}
        hoverIndicatorClassName="bg-interaction-hover"
        role="presentation"
      >
        {children}
      </FluidActionList>
    </DropdownMenuContent>
  );
}

function FluidDropdownMenuItem({
  className,
  index,
  ...props
}: FluidDropdownMenuItemProps) {
  return (
    <DropdownMenuItem
      {...props}
      className={cn(
        "w-full justify-start text-left focus:bg-transparent",
        className
      )}
      nativeButton
      render={<FluidActionListItem index={index} />}
    />
  );
}

function FluidDropdownMenuRadioItem({
  className,
  index,
  ...props
}: FluidDropdownMenuRadioItemProps) {
  return (
    <DropdownMenuRadioItem
      {...props}
      className={cn(
        "w-full justify-start text-left focus:bg-transparent",
        className
      )}
      nativeButton
      render={<FluidActionListItem index={index} />}
    />
  );
}

function FluidDropdownMenuCheckboxItem({
  className,
  index,
  ...props
}: Omit<
  React.ComponentProps<typeof DropdownMenuCheckboxItem>,
  "nativeButton" | "render"
> & { index: number }) {
  return (
    <DropdownMenuCheckboxItem
      {...props}
      className={cn(
        "w-full justify-start text-left focus:bg-transparent",
        className
      )}
      nativeButton
      render={<FluidActionListItem index={index} />}
    />
  );
}

function FluidDropdownMenuSubTrigger({
  index,
  className,
  ...props
}: Omit<
  React.ComponentProps<typeof DropdownMenuSubTrigger>,
  "render" | "nativeButton"
> & { index: number }) {
  return (
    <DropdownMenuSubTrigger
      {...props}
      className={cn(
        "w-full justify-start text-left focus:bg-transparent data-open:bg-transparent data-popup-open:bg-transparent",
        className
      )}
      nativeButton
      render={<FluidActionListItem index={index} />}
    />
  );
}

export {
  FluidDropdownMenuCheckboxItem,
  FluidDropdownMenuSubContent,
  FluidDropdownMenuGroup,
  FluidDropdownMenuSubTrigger,
  FluidDropdownMenuContent,
  FluidDropdownMenuItem,
  FluidDropdownMenuRadioItem,
  type FluidDropdownMenuContentProps,
  type FluidDropdownMenuItemProps,
  type FluidDropdownMenuRadioItemProps,
};

function FluidDropdownMenuSubContent({
  children,
  className,
  ...props
}: React.ComponentProps<typeof DropdownMenuSubContent>) {
  return (
    <DropdownMenuSubContent
      {...props}
      className={cn(
        "motion-reduce:animate-none! motion-reduce:transition-none!",
        className
      )}
    >
      <FluidActionList
        className="-m-1 max-w-none p-1"
        hoverIndicatorClassName="bg-interaction-hover"
        role="presentation"
      >
        {children}
      </FluidActionList>
    </DropdownMenuSubContent>
  );
}
