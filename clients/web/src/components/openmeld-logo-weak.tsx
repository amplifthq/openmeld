"use client";

import {
	OPENMELD_LOGO_CURRENT_COLOR as SHARED_OPENMELD_LOGO_CURRENT_COLOR,
	OPENMELD_LOGO_LINES as SHARED_OPENMELD_LOGO_LINES,
} from "@openmeld/ui/components/openmeld-logo-core";
import {
	OpenMeldLogoWeak,
	type OpenMeldLogoWeakProps,
} from "@openmeld/ui/components/openmeld-logo-weak";

export const OPENMELD_LOGO_CURRENT_COLOR = SHARED_OPENMELD_LOGO_CURRENT_COLOR;
export const OPENMELD_LOGO_LINES = SHARED_OPENMELD_LOGO_LINES;
export type OpenMeldLogoProps = OpenMeldLogoWeakProps;

export function OpenMeldLogo(props: OpenMeldLogoProps) {
	return <OpenMeldLogoWeak {...props} />;
}
