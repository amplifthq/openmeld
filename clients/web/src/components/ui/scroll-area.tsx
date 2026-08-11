"use client";

// Adapted from Lina by SameerJS6 (https://lina.sameer.sh) — lina-radix
// scroll-area. Changes from the original: Lina's gradient-only ScrollMask is
// replaced by the shared scroll-fade primitives (surface-aware gradient +
// chevron cues via useScrollEdges/ScrollEdgeCue), the scrollbar is restyled to
// the Fluid Functionalism shape system, and tw-animate-css visibility classes
// are swapped for a plain opacity transition.

import {
  createContext,
  forwardRef,
  useContext,
  useRef,
  type ComponentPropsWithoutRef,
  type ComponentRef,
} from "react";
import * as ScrollAreaPrimitive from "@radix-ui/react-scroll-area";
import { cn } from "@openmeld/ui/lib/utils";
import { useShape } from "@openmeld/ui/lib/shape-context";
import {
  useScrollEdges,
  ScrollEdgeCue,
  type ScrollEdgeCueSize,
} from "#/lib/scroll-fade.tsx";
import { useTouchPrimary } from "#/hooks/use-touch-primary.tsx";

// On touch-primary devices the Radix machinery is skipped entirely in favour
// of native overflow scrolling (better physics, momentum, rubber-banding);
// the context lets the exported ScrollBar no-op in that branch.
const ScrollAreaContext = createContext<boolean>(false);

type Orientation = "vertical" | "horizontal" | "both";

interface ScrollAreaProps
  extends ComponentPropsWithoutRef<typeof ScrollAreaPrimitive.Root> {
  viewportClassName?: string;
  /** Surface-gradient + chevron cues at edges with more content. Auto-shows
   *  on overflow; set to `false` to disable. Defaults to `true`. */
  scrollFade?: boolean;
  /** Cue band size along the scroll axis: `"tight"` (32px) or
   *  `"comfortable"` (60px). Defaults to `"comfortable"`. */
  cueSize?: ScrollEdgeCueSize;
  /** Show the directional chevron in the cues. The gradient fade always
   *  renders; set to `false` for fade-only cues. Defaults to `true`. */
  chevron?: boolean;
  /** Which axes get scrollbars and edge cues. Defaults to `"vertical"`. */
  orientation?: Orientation;
}

const ScrollArea = forwardRef<
  ComponentRef<typeof ScrollAreaPrimitive.Root>,
  ScrollAreaProps
>(
  (
    {
      className,
      children,
      scrollHideDelay = 0,
      viewportClassName,
      scrollFade = true,
      cueSize = "comfortable",
      chevron = true,
      orientation = "vertical",
      ...props
    },
    ref
  ) => {
    const viewportRef = useRef<HTMLDivElement>(null);
    const isTouch = useTouchPrimary();
    const edges = useScrollEdges(viewportRef, {
      enabled: scrollFade,
      axis: orientation,
    });

    // Cues read the substrate surface from context — ScrollArea doesn't
    // elevate, so the gradient matches whatever background it sits on.
    const cues = scrollFade && (
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 z-10 overflow-hidden rounded-[inherit]"
      >
        {orientation !== "horizontal" && (
          <>
            <ScrollEdgeCue mode="absolute" edge="top" visible={edges.top} size={cueSize} chevron={chevron} />
            <ScrollEdgeCue mode="absolute" edge="bottom" visible={edges.bottom} size={cueSize} chevron={chevron} />
          </>
        )}
        {orientation !== "vertical" && (
          <>
            <ScrollEdgeCue mode="absolute" edge="left" visible={edges.left} size={cueSize} chevron={chevron} />
            <ScrollEdgeCue mode="absolute" edge="right" visible={edges.right} size={cueSize} chevron={chevron} />
          </>
        )}
      </div>
    );

    return (
      <ScrollAreaContext.Provider value={isTouch}>
        {isTouch ? (
          <div
            ref={ref}
            role="group"
            data-slot="scroll-area"
            aria-roledescription="scroll area"
            className={cn("relative overflow-hidden", className)}
            {...props}
          >
            <div
              ref={viewportRef}
              data-slot="scroll-area-viewport"
              className={cn(
                "size-full rounded-[inherit]",
                orientation === "vertical" && "overflow-y-auto",
                orientation === "horizontal" && "overflow-x-auto",
                orientation === "both" && "overflow-auto",
                viewportClassName
              )}
              tabIndex={0}
            >
              {children}
            </div>
            {cues}
          </div>
        ) : (
          <ScrollAreaPrimitive.Root
            ref={ref}
            data-slot="scroll-area"
            scrollHideDelay={scrollHideDelay}
            className={cn("relative overflow-hidden", className)}
            {...props}
          >
            <ScrollAreaPrimitive.Viewport
              ref={viewportRef}
              data-slot="scroll-area-viewport"
              className={cn("size-full rounded-[inherit]", viewportClassName)}
            >
              {children}
            </ScrollAreaPrimitive.Viewport>
            {cues}
            {orientation !== "horizontal" && <ScrollBar orientation="vertical" />}
            {orientation !== "vertical" && <ScrollBar orientation="horizontal" />}
            {orientation === "both" && <ScrollAreaPrimitive.Corner />}
          </ScrollAreaPrimitive.Root>
        )}
      </ScrollAreaContext.Provider>
    );
  }
);

ScrollArea.displayName = "ScrollArea";

const ScrollBar = forwardRef<
  ComponentRef<typeof ScrollAreaPrimitive.ScrollAreaScrollbar>,
  ComponentPropsWithoutRef<typeof ScrollAreaPrimitive.ScrollAreaScrollbar>
>(({ className, orientation = "vertical", ...props }, ref) => {
  const isTouch = useContext(ScrollAreaContext);
  const shape = useShape();

  if (isTouch) return null;

  return (
    <ScrollAreaPrimitive.ScrollAreaScrollbar
      ref={ref}
      orientation={orientation}
      data-slot="scroll-area-scrollbar"
      // Scrollbar show/hide is plain CSS opacity matching the cue fade —
      // 160ms in, 120ms out (exits faster, per the animation guidelines);
      // spring tokens are framer-motion configs and don't apply here.
      className={cn(
        // The 10px track stays as a comfortable hit target; the thumb inside
        // it rests narrow and low-contrast, then widens + darkens on hover so
        // it gets out of the way until you reach for it.
        "group/scrollbar z-20 flex touch-none select-none",
        // Show immediately; on hide, wait out the 150ms thumb shrink before
        // fading so the thumb visibly narrows back first instead of the fade
        // masking it.
        "transition-opacity duration-120 ease-out data-[state=visible]:duration-160",
        "data-[state=visible]:opacity-100 data-[state=hidden]:opacity-0",
        "data-[state=hidden]:delay-160 data-[state=visible]:delay-0",
        orientation === "vertical" && "h-full w-2.5",
        orientation === "horizontal" && "h-2.5 w-full flex-col",
        className
      )}
      {...props}
    >
      <ScrollAreaPrimitive.ScrollAreaThumb
        data-slot="scroll-area-thumb"
        className={cn(
          "relative bg-foreground/25 transition-[background-color,width,height] duration-160 ease-in-out",
          "group-hover/scrollbar:bg-foreground/45 active:!bg-foreground/60",
          shape.bg,
          orientation === "vertical" &&
            "mx-auto my-1 w-1 group-hover/scrollbar:w-1.5",
          orientation === "horizontal" &&
            "my-auto mx-1 h-1 group-hover/scrollbar:h-1.5"
        )}
      />
    </ScrollAreaPrimitive.ScrollAreaScrollbar>
  );
});

ScrollBar.displayName = "ScrollBar";

export { ScrollArea, ScrollBar };
export type { ScrollAreaProps };
