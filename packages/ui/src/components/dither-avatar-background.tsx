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
// Bound retained RGBA pixels to 4 MiB. Directory routes reuse these immutable
// rasters instead of repeating thousands of fillRect calls on every mount.
const MAX_CACHED_PIXELS = 1024 * 1024;
const MAX_CACHED_RASTERS = 256;
const rasters = new Map<string, HTMLCanvasElement>();
let cachedPixels = 0;

function drawCachedDither(
  context: CanvasRenderingContext2D,
  seed: number | string,
  size: number
) {
  const key = JSON.stringify([seed, size]);
  const cached = rasters.get(key);
  if (cached) {
    rasters.delete(key);
    rasters.set(key, cached);
    context.drawImage(cached, 0, 0);
    return;
  }

  drawDither(context, seed, size);
  const pixels = size * size;
  if (pixels > MAX_CACHED_PIXELS) {
    return;
  }
  const raster = document.createElement("canvas");
  raster.width = size;
  raster.height = size;
  const rasterContext = raster.getContext("2d");
  if (!rasterContext) {
    return;
  }
  rasterContext.drawImage(context.canvas, 0, 0);
  while (
    cachedPixels + pixels > MAX_CACHED_PIXELS ||
    rasters.size >= MAX_CACHED_RASTERS
  ) {
    const oldest = rasters.entries().next().value;
    if (!oldest) {
      break;
    }
    rasters.delete(oldest[0]);
    cachedPixels -= oldest[1].width * oldest[1].height;
  }
  rasters.set(key, raster);
  cachedPixels += pixels;
}

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
    drawCachedDither(context, seed, backingSize);
  }, [seed, size]);

  return (
    <canvas
      {...props}
      aria-hidden="true"
      className={cn(
        "absolute -inset-px h-[calc(100%+2px)] w-[calc(100%+2px)]",
        className
      )}
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
