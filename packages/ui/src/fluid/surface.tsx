"use client";

import { type ComponentProps, createContext, use } from "react";
import { cn } from "#lib/utils";

const SurfaceDepth = createContext(0);
const surfaces = [
  "bg-card shadow-surface-1",
  "bg-surface-2 shadow-surface-2",
  "bg-surface-3 shadow-surface-3",
] as const;

/** Paired substrate and shadow tokens; nested surfaces rise one quiet step. */
function Surface({ className, children, ...props }: ComponentProps<"div">) {
  const depth = use(SurfaceDepth);
  return (
    <SurfaceDepth.Provider value={Math.min(depth + 1, surfaces.length - 1)}>
      <div
        data-surface-depth={depth}
        {...props}
        className={cn("rounded-md", surfaces[depth], className)}
      >
        {children}
      </div>
    </SurfaceDepth.Provider>
  );
}

export { Surface };
