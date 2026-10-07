import { FluidDropdownMenuItem } from "@openmeld/ui/fluid/dropdown-menu";
import { GearSixIcon } from "@phosphor-icons/react";
import type { ComponentProps } from "react";
import {
	DESKTOP_UPDATE_ATTENTION_LABEL,
	DesktopUpdateIndicator,
	useDesktopUpdateAttention,
} from "#/desktop/updater";

/** The shell entry and its accessible update attention stay together. */
export function AppSettingsMenuItem({
	...props
}: Omit<
	ComponentProps<typeof FluidDropdownMenuItem>,
	"children" | "aria-label"
>) {
	const attention = useDesktopUpdateAttention();
	return (
		<FluidDropdownMenuItem
			{...props}
			aria-label={
				attention ? `Settings, ${DESKTOP_UPDATE_ATTENTION_LABEL}` : "Settings"
			}
		>
			<GearSixIcon />
			<span className="flex-1">Settings</span>
			{attention ? <DesktopUpdateIndicator /> : null}
		</FluidDropdownMenuItem>
	);
}
