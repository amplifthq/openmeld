import { Button } from "@openmeld/ui/components/button";
import { FluidNavMenu, FluidNavMenuItem } from "@openmeld/ui/fluid/nav-menu";
import { SquaresFourIcon, TableIcon } from "@phosphor-icons/react";
import { useBrowserPreference } from "#/lib/use-browser-preference";

export function useSpaceLayout(profileId: string, organizationId: string) {
	const [saved, setLayout] = useBrowserPreference(
		`openmeld.spaces.layout:${profileId}:${organizationId}`
	);
	return {
		layout: saved === "table" ? ("table" as const) : ("cards" as const),
		setLayout,
	};
}

export function SpaceLayoutSwitch(input: {
	layout: "cards" | "table";
	setLayout: (value: string) => void;
}) {
	return (
		<FluidNavMenu
			activeValue={input.layout}
			aria-label="Space view"
			className="mr-2 [&_[data-sidebar=menu]]:flex-row"
		>
			{(["cards", "table"] as const).map((value, index) => (
				<FluidNavMenuItem index={index} key={value} value={value}>
					<Button
						aria-pressed={input.layout === value}
						onClick={() => input.setLayout(value)}
						size="sm"
						variant="ghost"
					>
						{value === "cards" ? <SquaresFourIcon /> : <TableIcon />}
						{value === "cards" ? "Cards" : "Table"}
					</Button>
				</FluidNavMenuItem>
			))}
		</FluidNavMenu>
	);
}
