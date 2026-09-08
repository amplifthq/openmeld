"use client";

import {
  type ComponentPropsWithoutRef,
  type ReactNode,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  animateFluidAvatar,
  drawFluidAvatar,
  fluidAvatarColor,
} from "#lib/fluid-avatar-renderer";
import { cn } from "#lib/utils";

export type FluidAvatarProps = Omit<
  ComponentPropsWithoutRef<"span">,
  "color"
> & {
  seed: string;
  size: number;
  shape?: "circle" | "rounded-square";
  animated?: boolean;
  animateOnHover?: boolean;
  fallback?: ReactNode;
};

export function FluidAvatar({
  seed,
  size,
  shape = "circle",
  animated = false,
  animateOnHover = false,
  fallback,
  className,
  style,
  ...props
}: FluidAvatarProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const timeRef = useRef(0);
  const readyRef = useRef(false);
  const [hovered, setHovered] = useState(false);
  const color = fluidAvatarColor(seed);
  const requested = animated || (animateOnHover && hovered);
  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    const pixels = Math.max(
      1,
      Math.min(192, Math.round(size * Math.min(devicePixelRatio || 1, 2)))
    );
    canvas.width = pixels;
    canvas.height = pixels;
    readyRef.current = drawFluidAvatar(canvas, color, timeRef.current);
  }, [color, size]);
  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!(canvas && readyRef.current && requested)) {
      return;
    }
    let visible = false;
    let stop: (() => void) | undefined;
    const reduced = matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => {
      stop?.();
      stop = undefined;
      if (requested && visible && !reduced.matches) {
        stop = animateFluidAvatar((deltaSeconds) => {
          const nextTime = timeRef.current + deltaSeconds;
          if (drawFluidAvatar(canvas, color, nextTime)) {
            timeRef.current = nextTime;
          } else {
            stop?.();
            stop = undefined;
          }
        });
      }
    };
    const observer = new IntersectionObserver(([entry]) => {
      visible = entry?.isIntersecting ?? false;
      update();
    });
    observer.observe(canvas);
    reduced.addEventListener("change", update);
    return () => {
      stop?.();
      observer.disconnect();
      reduced.removeEventListener("change", update);
    };
  }, [color, requested]);
  return (
    <span
      {...props}
      className={cn(
        "relative inline-grid shrink-0 place-items-center overflow-hidden shadow-[0_1px_2px_rgb(0_0_0_/_5%)]",
        shape === "circle" ? "rounded-full" : "rounded-[22%]",
        className
      )}
      data-shape={shape}
      data-slot="fluid-avatar"
      onPointerEnter={(event) => {
        if (animateOnHover && event.pointerType === "mouse") {
          setHovered(true);
        }
        props.onPointerEnter?.(event);
      }}
      onPointerLeave={(event) => {
        setHovered(false);
        props.onPointerLeave?.(event);
      }}
      style={{
        background: `linear-gradient(to bottom, color-mix(in srgb, ${color} 18%, #f3f5f9), ${color})`,
        width: size,
        height: size,
        ...style,
      }}
    >
      {fallback}
      <canvas
        aria-hidden="true"
        className="absolute inset-0 h-full w-full"
        ref={canvasRef}
        tabIndex={-1}
      />
    </span>
  );
}
