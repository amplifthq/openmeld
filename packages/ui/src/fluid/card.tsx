"use client";

import { type ComponentProps, forwardRef } from "react";
import { cn } from "#lib/utils";
import { SharedLayoutGroup, SharedLayoutItem } from "./shared-layout-group";

type FluidCardGroupProps = ComponentProps<typeof SharedLayoutGroup>;
type FluidCardItemProps = ComponentProps<typeof SharedLayoutItem>;

const FluidCardGroup = forwardRef<HTMLDivElement, FluidCardGroupProps>(
  ({ className, ...props }, ref) => (
    <SharedLayoutGroup
      className={cn("relative min-w-0", className)}
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
      className={cn(
        "h-full min-w-0 rounded-md bg-card [&>div>a:hover]:bg-transparent [&>div>a]:bg-transparent [&>div>button:hover]:bg-transparent [&>div>button]:bg-transparent",
        className
      )}
      data-fluid-card-item=""
      ref={ref}
      {...props}
    />
  )
);

FluidCardItem.displayName = "FluidCardItem";

export { FluidCardGroup, FluidCardItem };
