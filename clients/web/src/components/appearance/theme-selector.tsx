"use client";

import { DropdownMenuRadioGroup } from "@openmeld/ui/components/dropdown-menu";
import { FluidActionList } from "@openmeld/ui/fluid/action-list";
import { FluidDropdownMenuRadioItem } from "@openmeld/ui/fluid/dropdown-menu";
import { useTheme } from "next-themes";
import { useSyncExternalStore } from "react";
import { THEME_CHOICES } from "./theme-choices";

const subscribe = () => () => undefined;
const clientSnapshot = () => true;
const serverSnapshot = () => false;
const groupClassName =
	"flex w-fit flex-row gap-0 rounded-full border border-border p-px";
const itemClassName =
	"size-5 min-w-5 justify-center rounded-full! p-0! text-muted-foreground hover:bg-transparent focus-visible:ring-2 focus-visible:ring-ring data-checked:bg-interaction-active data-checked:text-foreground transition-none [&_[data-slot=dropdown-menu-radio-item-indicator]]:hidden";

/** Compact account-menu control; Appearance uses full-size theme cards. */
export function ThemeSelector() {
	const { theme, setTheme } = useTheme();
	const mounted = useSyncExternalStore(
		subscribe,
		clientSnapshot,
		serverSnapshot
	);
	const value = mounted ? theme : undefined;
	const hover = (
		<FluidActionList
			axis="x"
			className={groupClassName}
			focusIndicatorClassName="rounded-full"
			hoverIndicatorClassName="rounded-full"
		/>
	);

	return (
		<DropdownMenuRadioGroup
			aria-label="Theme"
			onValueChange={setTheme}
			render={hover}
			value={value ?? ""}
		>
			{THEME_CHOICES.map(({ value: choice, label, icon: Icon }, index) => (
				<FluidDropdownMenuRadioItem
					aria-label={label}
					className={itemClassName}
					closeOnClick={false}
					index={index}
					key={choice}
					value={choice}
				>
					<Icon aria-hidden="true" className="size-3" />
				</FluidDropdownMenuRadioItem>
			))}
		</DropdownMenuRadioGroup>
	);
}
