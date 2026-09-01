"use client";

import {
  type MotionValue,
  motion,
  useMotionValue,
  useReducedMotion,
  useSpring,
  useTransform,
} from "framer-motion";
import {
  createContext,
  forwardRef,
  type HTMLAttributes,
  type ReactNode,
  use,
  useRef,
} from "react";
import { useMediaQuery } from "#hooks/use-media-query";
import { cn } from "#lib/utils";

// Cursor-proximity magnification adapted from Motion Primitives' Dock:
// https://github.com/ibelick/motion-primitives/blob/main/components/core/dock.tsx
// Copyright (c) 2024 ibelick, used under the MIT License. See
// packages/ui/THIRD_PARTY_NOTICES.md.

const DEFAULT_DISTANCE_PX = 84;
const DEFAULT_MAGNIFICATION = 1.32;
const RESTING_POINTER_POSITION = Number.POSITIVE_INFINITY;

type MagnifyingDockContextValue = {
  distance: number;
  enabled: boolean;
  magnification: number;
  pointerX: MotionValue<number>;
};

const MagnifyingDockContext = createContext<MagnifyingDockContextValue | null>(
  null
);

function useMagnifyingDock() {
  const context = use(MagnifyingDockContext);
  if (!context) {
    throw new Error("MagnifyingDockItem must be used within MagnifyingDock.");
  }
  return context;
}

export type MagnifyingDockProps = HTMLAttributes<HTMLDivElement> & {
  children: ReactNode;
  /** Pixel range on either side of an item affected by the pointer. */
  distance?: number;
  /** Maximum visual scale of the item nearest the pointer. */
  magnification?: number;
};

export const MagnifyingDock = forwardRef<HTMLDivElement, MagnifyingDockProps>(
  (
    {
      children,
      className,
      distance = DEFAULT_DISTANCE_PX,
      magnification = DEFAULT_MAGNIFICATION,
      onPointerLeave,
      onPointerMove,
      ...props
    },
    ref
  ) => {
    const pointerX = useMotionValue(RESTING_POINTER_POSITION);
    const reduceMotion = useReducedMotion() === true;
    const hasFinePointer = useMediaQuery("(hover: hover) and (pointer: fine)");
    const enabled = hasFinePointer && !reduceMotion;

    return (
      <MagnifyingDockContext.Provider
        value={{ distance, enabled, magnification, pointerX }}
      >
        <div
          {...props}
          className={cn("flex min-w-0 items-end", className)}
          data-motion-enabled={enabled || undefined}
          data-slot="magnifying-dock"
          onPointerLeave={(event) => {
            onPointerLeave?.(event);
            pointerX.set(RESTING_POINTER_POSITION);
          }}
          onPointerMove={(event) => {
            onPointerMove?.(event);
            if (enabled && event.pointerType === "mouse") {
              pointerX.set(event.clientX);
            }
          }}
          ref={ref}
        >
          {children}
        </div>
      </MagnifyingDockContext.Provider>
    );
  }
);

MagnifyingDock.displayName = "MagnifyingDock";

export type MagnifyingDockItemProps = HTMLAttributes<HTMLDivElement> & {
  caption?: ReactNode;
  captionClassName?: string;
  children: ReactNode;
  visualClassName?: string;
};

export const MagnifyingDockItem = forwardRef<
  HTMLDivElement,
  MagnifyingDockItemProps
>(
  (
    {
      caption,
      captionClassName,
      children,
      className,
      visualClassName,
      ...props
    },
    forwardedRef
  ) => {
    const { distance, enabled, magnification, pointerX } = useMagnifyingDock();
    const itemRef = useRef<HTMLDivElement>(null);
    const pointerDistance = useTransform(pointerX, (pointerPosition) => {
      if (!(enabled && Number.isFinite(pointerPosition) && itemRef.current)) {
        return distance;
      }
      const bounds = itemRef.current.getBoundingClientRect();
      return pointerPosition - bounds.left - bounds.width / 2;
    });
    const targetScale = useTransform(
      pointerDistance,
      [-distance, 0, distance],
      [1, magnification, 1]
    );
    const scale = useSpring(targetScale, {
      damping: 18,
      mass: 0.12,
      stiffness: 210,
    });

    return (
      <div
        {...props}
        className={cn(
          "relative flex min-h-14 min-w-14 shrink-0 flex-col items-center justify-end gap-1.5",
          className
        )}
        data-slot="magnifying-dock-item"
        ref={(node) => {
          itemRef.current = node;
          if (typeof forwardedRef === "function") {
            forwardedRef(node);
            return;
          }
          if (forwardedRef) {
            forwardedRef.current = node;
          }
        }}
      >
        <motion.div
          className={cn(
            "relative flex origin-bottom items-center justify-center will-change-transform",
            visualClassName
          )}
          data-slot="magnifying-dock-item-visual"
          style={{ scale: enabled ? scale : 1 }}
        >
          {children}
        </motion.div>
        {caption ? (
          <div
            className={cn(
              "max-w-16 truncate text-center text-[11px] text-muted-foreground leading-4",
              captionClassName
            )}
            data-slot="magnifying-dock-item-caption"
          >
            {caption}
          </div>
        ) : null}
      </div>
    );
  }
);

MagnifyingDockItem.displayName = "MagnifyingDockItem";
