"use client";

import {
  OpenMeldLogoCore,
  type OpenMeldLogoCoreProps,
} from "#components/openmeld-logo-core";

export type OpenMeldLogoWeakProps = Omit<
  OpenMeldLogoCoreProps,
  "intensity" | "pointerTracking"
> & {
  pointerTracking?: OpenMeldLogoCoreProps["pointerTracking"];
};

export function OpenMeldLogoWeak({
  className = "mx-auto",
  pointerTracking = "element",
  ...props
}: OpenMeldLogoWeakProps) {
  return (
    <OpenMeldLogoCore
      className={className}
      intensity="weak"
      pointerTracking={pointerTracking}
      {...props}
    />
  );
}
