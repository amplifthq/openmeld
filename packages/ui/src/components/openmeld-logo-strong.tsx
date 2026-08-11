"use client";

import {
  OpenMeldLogoCore,
  type OpenMeldLogoCoreProps,
} from "#components/openmeld-logo-core";

export type OpenMeldLogoStrongAppearance =
  import("#components/openmeld-logo-core").OpenMeldLogoStrongAppearance;

export type OpenMeldLogoStrongProps = Omit<
  OpenMeldLogoCoreProps,
  "intensity" | "pointerTracking" | "strongLightAppearance"
> & {
  lightAppearance?: OpenMeldLogoStrongAppearance;
  pointerTracking?: OpenMeldLogoCoreProps["pointerTracking"];
};

export function OpenMeldLogoStrong({
  lightAppearance,
  pointerTracking = "viewport",
  ...props
}: OpenMeldLogoStrongProps) {
  return (
    <OpenMeldLogoCore
      intensity="strong"
      pointerTracking={pointerTracking}
      strongLightAppearance={lightAppearance}
      {...props}
    />
  );
}
