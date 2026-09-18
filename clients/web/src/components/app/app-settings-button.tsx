import { cn } from "@openmeld/ui/lib/utils";
import { GearSixIcon } from "@phosphor-icons/react";
import {
	DESKTOP_UPDATE_ATTENTION_LABEL,
	DesktopUpdateIndicator,
	useDesktopUpdateAttention,
} from "#/desktop/updater";

/** The shell entry and its accessible update attention stay together. */
export function AppSettingsButton(input: {
	className: string;
	isActive: boolean;
	onClick: () => void;
}) {
	const attention = useDesktopUpdateAttention();
	return (
		<button
			aria-current={input.isActive ? "page" : undefined}
			aria-label={
				attention ? `Settings, ${DESKTOP_UPDATE_ATTENTION_LABEL}` : "Settings"
			}
			className={cn(input.className, "relative")}
			onClick={input.onClick}
			type="button"
		>
			<GearSixIcon className="size-4" />
			{attention ? (
				<DesktopUpdateIndicator className="absolute top-1 right-1" />
			) : null}
		</button>
	);
}
