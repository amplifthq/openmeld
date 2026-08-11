"use client";

import { type ComponentProps, forwardRef } from "react";
import { cn } from "#lib/utils";
import { SharedLayoutGroup, SharedLayoutItem } from "./shared-layout-group";

type FluidCardGroupProps = ComponentProps<typeof SharedLayoutGroup>;
type FluidCardItemProps = ComponentProps<typeof SharedLayoutItem>;

const FluidCardGroup = forwardRef<HTMLDivElement, FluidCardGroupProps>(
  ({ className, ...props }, ref) => (
    <SharedLayoutGroup
      className={cn("relative", className)}
      data-fluid-card-group=""
      ref={ref}
      {...props}
    />
  )
);

FluidCardGroup.displayName = "FluidCardGroup";

const FluidCardItem = forwardRef<HTMLDivElement, FluidCardItemProps>(
  ({ className, ...props }, ref) => (
    <SharedLayoutItem
      className={cn("h-full rounded-md bg-card", className)}
      data-fluid-card-item=""
      ref={ref}
      {...props}
    />
  )
);

FluidCardItem.displayName = "FluidCardItem";

export { FluidCardGroup, FluidCardItem };
