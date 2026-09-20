"use client";

// Adapted from Fluid Functionalism's Base UI Dialog (September 9, 2026):
// https://www.fluidfunctionalism.com/r/base/dialog.json
// Reuse our Base UI focus/portal lifecycle and CSS motion instead of installing
// another dialog engine. The Fluid size ladder and elevated surface stay shared.
import type { ComponentProps } from "react";
import { DialogContent as BaseDialogContent } from "#components/dialog";
import { useShape } from "#lib/shape-context";
import { surfaceClasses } from "#lib/surface-classes";
import { cn } from "#lib/utils";
import { SurfaceProvider } from "../lib/surface-context";

export function DialogContent({
  size = "sm",
  className,
  children,
  ...props
}: ComponentProps<typeof BaseDialogContent> & { size?: "sm" | "lg" | "xl" }) {
  // Portaled dialogs share one calm surface, including nested confirmations.
  const level = 2;
  const shape = useShape();
  return (
    <BaseDialogContent
      className={cn(
        surfaceClasses(level, 4),
        shape.container,
        "motion-reduce:animate-none motion-reduce:duration-0",
        size === "sm" && "sm:max-w-[400px]",
        size === "lg" && "sm:max-w-[540px]",
        size === "xl" && "sm:max-w-[880px]",
        className
      )}
      {...props}
    >
      <SurfaceProvider value={level}>{children}</SurfaceProvider>
    </BaseDialogContent>
  );
}
