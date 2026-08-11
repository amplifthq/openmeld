import {
  OpenMeldLogoStrong,
  type OpenMeldLogoStrongProps,
} from "@openmeld/ui/components/openmeld-logo-strong";

export type OpenMeldLogoProps = OpenMeldLogoStrongProps;

export function OpenMeldLogo({
  ariaLabel = "OpenMeld",
  ...props
}: OpenMeldLogoProps) {
  return <OpenMeldLogoStrong ariaLabel={ariaLabel} {...props} />;
}
