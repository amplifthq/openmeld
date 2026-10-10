"use client";

import type { ReactNode } from "react";
import { OpenMeldLogoWeak } from "#components/openmeld-logo-weak";
import { cn } from "#lib/utils";

export function OpenMeldLoadingScreen({
  children,
  className,
}: {
  children?: ReactNode;
  className?: string;
}) {
  return (
    <main
      aria-busy="true"
      aria-label="Opening OpenMeld"
      className={cn(
        "grid min-h-svh place-items-center overflow-hidden bg-background text-foreground",
        className
      )}
    >
      <div className="flex flex-col items-center gap-6 px-6 text-center">
        <OpenMeldLogoWeak
          ariaLabel="OpenMeld"
          pointerTracking="element"
          scale={0.18}
        />
        {children}
      </div>
    </main>
  );
}
