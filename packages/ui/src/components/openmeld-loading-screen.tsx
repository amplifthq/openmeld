"use client";

import { OpenMeldLogoWeak } from "#components/openmeld-logo-weak";
import { cn } from "#lib/utils";

export function OpenMeldLoadingScreen({ className }: { className?: string }) {
  return (
    <main
      aria-busy="true"
      aria-label="Opening OpenMeld"
      className={cn(
        "grid min-h-svh place-items-center overflow-hidden bg-background text-foreground",
        className
      )}
    >
      <OpenMeldLogoWeak
        ariaLabel="OpenMeld"
        pointerTracking="element"
        scale={0.18}
      />
    </main>
  );
}
