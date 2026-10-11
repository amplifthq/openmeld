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
  ({ className, indicatorClassName, ...props }, ref) => (
    <SharedLayoutItem
      className={cn(
        "h-full min-w-0 overflow-hidden rounded-md bg-card has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring [&>div>a:hover]:bg-transparent [&>div>a]:bg-transparent [&>div>button:hover]:bg-transparent [&>div>button]:bg-transparent",
        className
      )}
      data-fluid-card-item=""
      indicatorClassName={cn("rounded-none", indicatorClassName)}
      ref={ref}
      {...props}
    />
  )
);

FluidCardItem.displayName = "FluidCardItem";

export { FluidCardGroup, FluidCardItem };
