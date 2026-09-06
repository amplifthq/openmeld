"use client";

import { motion, useReducedMotion } from "framer-motion";
import type { ItemRect } from "#hooks/use-proximity-hover";
import { springs } from "#lib/springs";
import { cn } from "#lib/utils";

/** Shared pointer highlight: layout travel with a short enter/leave fade. */
export function FluidHoverHighlight({
  rect,
  className,
  slot,
}: {
  rect: ItemRect;
  className?: string;
  slot: string;
}) {
  const reduceMotion = useReducedMotion() === true;
  return (
    <motion.div
      animate={{ opacity: 1 }}
      aria-hidden="true"
      className={cn(
        "pointer-events-none absolute bg-interaction-hover",
        className
      )}
      data-slot={slot}
      exit={{ opacity: 0, transition: { duration: reduceMotion ? 0 : 0.06 } }}
      initial={{ opacity: 0 }}
      layout={!reduceMotion}
      style={rect}
      transition={
        reduceMotion
          ? { duration: 0 }
          : { ...springs.fast, opacity: { duration: 0.08 } }
      }
    />
  );
}
