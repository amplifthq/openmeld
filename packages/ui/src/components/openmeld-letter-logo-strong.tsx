"use client";

import { OPENMELD_LETTER_O_LOGO_LINES as DEFAULT_OPENMELD_LETTER_O_LOGO_LINES } from "#components/openmeld-logo-core";
import {
  OpenMeldLogoStrong,
  type OpenMeldLogoStrongProps,
} from "#components/openmeld-logo-strong";

export type OpenMeldLetterLogoStrongProps = OpenMeldLogoStrongProps;

export function OpenMeldLetterLogoStrong({
  ariaLabel = "OpenMeld O logo",
  lines = DEFAULT_OPENMELD_LETTER_O_LOGO_LINES,
  ...props
}: OpenMeldLetterLogoStrongProps) {
  return <OpenMeldLogoStrong ariaLabel={ariaLabel} lines={lines} {...props} />;
}
