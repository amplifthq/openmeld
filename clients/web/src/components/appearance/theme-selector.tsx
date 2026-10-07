"use client";

import { DropdownMenuRadioGroup } from "@openmeld/ui/components/dropdown-menu";
import {
	ToggleGroup,
	ToggleGroupItem,
} from "@openmeld/ui/components/toggle-group";
import {
	FluidActionList,
	FluidActionListItem,
} from "@openmeld/ui/fluid/action-list";
import { FluidDropdownMenuRadioItem } from "@openmeld/ui/fluid/dropdown-menu";
import { DesktopIcon, MoonIcon, SunDimIcon } from "@phosphor-icons/react";
import { useTheme } from "next-themes";
import { useSyncExternalStore } from "react";

const THEME_CHOICES = [
	{ value: "light", label: "Light", icon: SunDimIcon },
	{ value: "dark", label: "Dark", icon: MoonIcon },
	{ value: "system", label: "System", icon: DesktopIcon },
] as const;

const subscribe = () => () => undefined;
const clientSnapshot = () => true;
const serverSnapshot = () => false;
const groupClassName =
	"flex w-fit flex-row gap-0 rounded-full border border-border p-px";
const itemClassName =
	"size-6 min-w-6 justify-center rounded-full! p-0! text-muted-foreground hover:bg-transparent focus-visible:ring-2 focus-visible:ring-ring data-checked:bg-interaction-active data-checked:text-foreground aria-pressed:bg-interaction-active aria-pressed:text-foreground transition-none [&_[data-slot=dropdown-menu-radio-item-indicator]]:hidden";

/** One appearance preference and icon set, with the owning surface's keyboard semantics. */
export function ThemeSelector({ inMenu = false }: { inMenu?: boolean }) {
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

	if (inMenu) {
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
						<Icon aria-hidden="true" className="size-3.5" />
					</FluidDropdownMenuRadioItem>
				))}
			</DropdownMenuRadioGroup>
		);
	}

	return (
		<ToggleGroup
			aria-label="Theme"
			className={groupClassName}
			onValueChange={(values) => {
				if (values[0]) {
					setTheme(values[0]);
				}
			}}
			render={hover}
			spacing={0}
			value={value ? [value] : []}
		>
			{THEME_CHOICES.map(({ value: choice, label, icon: Icon }, index) => (
				<ToggleGroupItem
					aria-label={label}
					className={itemClassName}
					key={choice}
					render={<FluidActionListItem index={index} />}
					value={choice}
				>
					<Icon aria-hidden="true" className="size-3.5" />
				</ToggleGroupItem>
			))}
		</ToggleGroup>
	);
}
