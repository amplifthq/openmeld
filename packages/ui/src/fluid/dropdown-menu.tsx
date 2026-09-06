"use client";

import type * as React from "react";
import {
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSubContent,
} from "#components/dropdown-menu";
import { FluidActionList, FluidActionListItem } from "#fluid/action-list";
import { cn } from "#lib/utils";

type FluidDropdownMenuContentProps = React.ComponentProps<
  typeof DropdownMenuContent
>;

type FluidDropdownMenuItemProps = Omit<
  React.ComponentProps<typeof DropdownMenuItem>,
  "nativeButton" | "render"
> & {
  index: number;
};

function FluidDropdownMenuContent({
  children,
  className,
  ...props
}: FluidDropdownMenuContentProps) {
  return (
    <DropdownMenuContent
      {...props}
      className={cn("motion-reduce:animate-none", className)}
    >
      <FluidActionList
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
      className={cn("justify-start text-left focus:bg-transparent", className)}
      nativeButton
      render={<FluidActionListItem index={index} />}
    />
  );
}

export {
  FluidDropdownMenuSubContent,
  FluidDropdownMenuContent,
  FluidDropdownMenuItem,
  type FluidDropdownMenuContentProps,
  type FluidDropdownMenuItemProps,
};

function FluidDropdownMenuSubContent({
  children,
  className,
  ...props
}: React.ComponentProps<typeof DropdownMenuSubContent>) {
  return (
    <DropdownMenuSubContent
      {...props}
      className={cn("motion-reduce:animate-none", className)}
    >
      <FluidActionList
        hoverIndicatorClassName="bg-interaction-hover"
        role="presentation"
      >
        {children}
      </FluidActionList>
    </DropdownMenuSubContent>
  );
}
