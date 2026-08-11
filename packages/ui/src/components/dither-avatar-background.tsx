"use client";

import { drawDither, generatePalette } from "@outpacelabs/avatars";
import {
  type ComponentPropsWithoutRef,
  type CSSProperties,
  useLayoutEffect,
  useRef,
} from "react";
import { cn } from "#lib/utils";

const MAX_DEVICE_PIXEL_RATIO = 2;

type DitherAvatarBackgroundProps = Omit<
  ComponentPropsWithoutRef<"canvas">,
  "height" | "width"
> & {
  seed: number | string;
  size: number;
};

export function DitherAvatarBackground({
  className,
  seed,
  size,
  style,
  ...props
}: DitherAvatarBackgroundProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fallbackColor = generatePalette(seed).colors[0];

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    const backingSize = resolveBackingSize(size);
    canvas.height = backingSize;
    canvas.width = backingSize;

    const context = canvas.getContext("2d");
    if (!context) {
      return;
    }
    drawDither(context, seed, backingSize);
  }, [seed, size]);

  return (
    <canvas
      {...props}
      aria-hidden="true"
      className={cn("absolute inset-0 size-full", className)}
      data-slot="dither-avatar-background"
      height={size}
      ref={canvasRef}
      style={mergeFallbackColor(style, fallbackColor)}
      tabIndex={-1}
      width={size}
    />
  );
}

function resolveBackingSize(size: number): number {
  const devicePixelRatio = Number.isFinite(globalThis.devicePixelRatio)
    ? globalThis.devicePixelRatio
    : 1;
  return Math.max(
    1,
    Math.round(size * Math.min(MAX_DEVICE_PIXEL_RATIO, devicePixelRatio))
  );
}

function mergeFallbackColor(
  style: CSSProperties | undefined,
  fallbackColor: string | undefined
): CSSProperties {
  return {
    backgroundColor: fallbackColor,
    ...style,
  };
}
