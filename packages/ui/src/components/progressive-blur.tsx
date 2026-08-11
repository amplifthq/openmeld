import type { ComponentProps } from "react";
import { cn } from "#lib/utils";

type ProgressiveBlurProps = ComponentProps<"div"> & {
  backgroundColor?: string;
  blurAmount?: string;
  /** Keeps the blur at full strength before fading across this outer edge. */
  blurFadeHeight?: string;
  height?: string;
  position?: "top" | "bottom";
};

// Adapted from Skiper UI's Skiper 41 primitive: https://skiper-ui.com/
function ProgressiveBlur({
  "aria-hidden": ariaHidden = true,
  backgroundColor = "var(--background)",
  blurAmount = "4px",
  blurFadeHeight,
  className,
  height = "150px",
  position = "top",
  style,
  ...props
}: ProgressiveBlurProps) {
  const isTop = position === "top";
  const backgroundDirection = isTop ? "to top" : "to bottom";
  const maskDirection = isTop ? "to bottom" : "to top";
  const blurMaskImage = blurFadeHeight
    ? `linear-gradient(${maskDirection}, black 0, black calc(100% - ${blurFadeHeight}), transparent 100%)`
    : `linear-gradient(${maskDirection}, black 50%, transparent)`;

  return (
    <div
      {...props}
      aria-hidden={ariaHidden}
      className={cn(
        "pointer-events-none absolute inset-x-0 select-none",
        className
      )}
      data-position={position}
      data-slot="progressive-blur"
      style={{
        [isTop ? "top" : "bottom"]: 0,
        height,
        backgroundImage: `linear-gradient(${backgroundDirection}, transparent, ${backgroundColor})`,
        WebkitMaskImage: blurMaskImage,
        maskImage: blurMaskImage,
        WebkitBackdropFilter: `blur(${blurAmount})`,
        backdropFilter: `blur(${blurAmount})`,
        WebkitUserSelect: "none",
        userSelect: "none",
        ...style,
      }}
    />
  );
}

export { ProgressiveBlur };
export type { ProgressiveBlurProps };
