"use client";

import {
  OpenMeldLogoWeak,
  type OpenMeldLogoWeakProps,
} from "#components/openmeld-logo-weak";
import { OPENMELD_LETTER_O_LOGO_LINES as DEFAULT_OPENMELD_LETTER_O_LOGO_LINES } from "#lib/openmeld-logo-lines";

export type OpenMeldLetterLogoWeakProps = OpenMeldLogoWeakProps;

export function OpenMeldLetterLogoWeak({
  ariaLabel = "OpenMeld O logo",
  lines = DEFAULT_OPENMELD_LETTER_O_LOGO_LINES,
  ...props
}: OpenMeldLetterLogoWeakProps) {
  return <OpenMeldLogoWeak ariaLabel={ariaLabel} lines={lines} {...props} />;
}
