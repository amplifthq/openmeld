"use client";

import type * as React from "react";
import {
  DropdownMenuContent,
  DropdownMenuItem,
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
  ...props
}: FluidDropdownMenuContentProps) {
  return (
    <DropdownMenuContent {...props}>
      <FluidActionList hoverIndicatorClassName="bg-muted" role="presentation">
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
      className={cn("focus:bg-transparent", className)}
      nativeButton
      render={<FluidActionListItem index={index} />}
    />
  );
}

export {
  FluidDropdownMenuContent,
  FluidDropdownMenuItem,
  type FluidDropdownMenuContentProps,
  type FluidDropdownMenuItemProps,
};
