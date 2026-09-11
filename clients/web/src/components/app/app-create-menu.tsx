import { Menu } from "@base-ui/react/menu";
import { HashIcon, PlusIcon, RobotIcon } from "@phosphor-icons/react";
import { Link } from "@tanstack/react-router";
import { useReducedMotion } from "framer-motion";
import { Liquid } from "liquid-gooey";
import { useEffect, useState } from "react";
import {
	buildOrganizationAgentCreationPath,
	buildOrganizationNewSpacePath,
} from "#/lib/organizations/organization-routes";
import { useAppNavigationPresentation } from "./app-navigation-presentation";

export function AppCreateMenu({ orgSlug }: { orgSlug: string }) {
	const [open, setOpen] = useState(false);
	const [keyboard, setKeyboard] = useState(false);
	const reducedMotion = useReducedMotion();
	return (
		<Menu.Root
			onOpenChange={(next, details) => {
				setKeyboard(details.event.type.startsWith("key"));
				setOpen(next);
			}}
			open={open}
		>
			<Menu.Trigger
				aria-label="Create"
				className="flex size-10 shrink-0 items-center justify-center rounded-full bg-sidebar-accent/60 text-sidebar-foreground/70 outline-none hover:bg-sidebar-accent hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-ring"
			>
				<PlusIcon aria-hidden="true" className="size-5" />
			</Menu.Trigger>
			<Menu.Portal>
				<Menu.Positioner
					align="start"
					className="z-50"
					side="right"
					sideOffset={12}
				>
					<Menu.Popup aria-label="Create" className="outline-none">
						<CreateOptions
							motion={!(reducedMotion || keyboard)}
							orgSlug={orgSlug}
						/>
					</Menu.Popup>
				</Menu.Positioner>
			</Menu.Portal>
		</Menu.Root>
	);
}

function CreateOptions({
	orgSlug,
	motion,
}: {
	orgSlug: string;
	motion: boolean;
}) {
	const { dismiss } = useAppNavigationPresentation();
	const [expanded, setExpanded] = useState(!motion);
	useEffect(() => {
		const frame = requestAnimationFrame(() => setExpanded(true));
		return () => cancelAnimationFrame(frame);
	}, []);
	const options = [
		{
			label: "New Agent",
			to: buildOrganizationAgentCreationPath(orgSlug),
			icon: RobotIcon,
		},
		{
			label: "New Space",
			to: buildOrganizationNewSpacePath(orgSlug),
			icon: HashIcon,
		},
	];
	return (
		<Liquid
			blur={6}
			className="relative w-32 text-popover-foreground"
			contrast={18}
			fill="var(--accent)"
			shadow="0 2px 8px rgba(0,0,0,.14)"
			style={{ height: options.length * 48 - 8 }}
		>
			{options.map((option, index) => (
				<Liquid.Item
					className="absolute top-0 left-0"
					key={option.label}
					radius={20}
					transition={motion ? "snappy" : { duration: 0 }}
					x={expanded || !motion ? 0 : -52}
					y={expanded || !motion ? index * 48 : 0}
				>
					<Menu.Item
						className="flex h-10 w-32 items-center justify-center gap-2 whitespace-nowrap rounded-full px-3 text-sm outline-none data-highlighted:bg-popover data-highlighted:ring-1 data-highlighted:ring-ring"
						nativeButton={false}
						onClick={dismiss}
						render={<Link to={option.to} />}
					>
						<option.icon aria-hidden="true" className="size-4 shrink-0" />
						{option.label}
					</Menu.Item>
				</Liquid.Item>
			))}
		</Liquid>
	);
}
