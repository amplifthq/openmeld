import { cn } from "@openmeld/ui/lib/utils";
import { GearSixIcon } from "@phosphor-icons/react";
import type { ComponentProps, ReactNode } from "react";
import {
	DESKTOP_UPDATE_ATTENTION_LABEL,
	DesktopUpdateIndicator,
	useDesktopUpdateAttention,
} from "#/desktop/updater";

/** The shell entry and its accessible update attention stay together. */
export function AppSettingsButton({
	children,
	className,
	isActive,
	...props
}: Omit<ComponentProps<"button">, "children" | "aria-label"> & {
	children?: ReactNode;
	isActive: boolean;
}) {
	const attention = useDesktopUpdateAttention();
	return (
		<button
			{...props}
			aria-current={isActive ? "page" : undefined}
			aria-label={
				attention ? `Settings, ${DESKTOP_UPDATE_ATTENTION_LABEL}` : "Settings"
			}
			className={cn(className, "relative")}
			type="button"
		>
			{children ?? <GearSixIcon className="size-4" />}
			{attention ? (
				<DesktopUpdateIndicator className="absolute top-1 right-1" />
			) : null}
		</button>
	);
}
