import { Menu } from "@base-ui/react/menu";
import {
	SharedLayoutGroup,
	SharedLayoutItem,
} from "@openmeld/ui/fluid/shared-layout-group";
import { surfaceClasses } from "@openmeld/ui/lib/surface-classes";
import { cn } from "@openmeld/ui/lib/utils";
import { ChatCircleTextIcon, PlusIcon, RobotIcon } from "@phosphor-icons/react";
import { Link } from "@tanstack/react-router";
import { useReducedMotion } from "framer-motion";
import { Liquid } from "liquid-gooey";
import { useEffect, useState } from "react";
import {
	buildOrganizationAgentCreationPath,
	buildOrganizationNewSpacePath,
} from "#/lib/organizations/organization-routes";
import { useAppNavigationPresentation } from "./app-navigation-presentation";
import { CollapsedRailTooltip } from "./app-rail-navigation";

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
			<CollapsedRailTooltip disabled={open} label="Create">
				<Menu.Trigger
					aria-label="Create"
					className="flex size-10 shrink-0 items-center justify-center rounded-full bg-sidebar-accent/60 text-sidebar-foreground/70 outline-none hover:bg-sidebar-accent hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-ring"
				>
					<PlusIcon
						aria-hidden="true"
						className="size-5 transition-transform duration-180 ease-out motion-reduce:transition-none"
						style={{ transform: open ? "rotate(45deg)" : "rotate(0deg)" }}
					/>
				</Menu.Trigger>
			</CollapsedRailTooltip>
			<Menu.Portal>
				<Menu.Positioner
					align="center"
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
			icon: ChatCircleTextIcon,
		},
	];
	return (
		<SharedLayoutGroup>
			<Liquid
				blur={6}
				className="relative w-32 text-popover-foreground [&>[data-gooey-svg]]:opacity-55"
				contrast={18}
				fill="var(--surface-3)"
				filterPadding={96}
				style={{ height: options.length * 44 - 4 }}
			>
				{options.map((option, index) => (
					<Liquid.Item
						className="absolute top-0 left-0"
						delay={motion ? index * 60 : 0}
						key={option.label}
						radius={20}
						scale={expanded || !motion ? 1 : 0.32}
						transition={motion ? "snappy" : { duration: 0 }}
						x={expanded || !motion ? 0 : -96}
						y={expanded || !motion ? index * 44 : (options.length - 1) * 22}
					>
						<SharedLayoutItem
							className={cn("rounded-full", surfaceClasses(3))}
							indicatorClassName="rounded-full"
							itemId={option.label}
						>
							<Menu.Item
								className="flex h-10 w-32 items-center justify-center overflow-hidden whitespace-nowrap rounded-full text-sm outline-none"
								nativeButton={false}
								onClick={dismiss}
								render={<Link to={option.to} />}
							>
								<span
									className="flex items-center gap-2 transition-opacity duration-100 motion-reduce:transition-none"
									style={{
										opacity: expanded ? 1 : 0,
										transitionDelay: motion ? `${120 + index * 60}ms` : "0ms",
									}}
								>
									<option.icon aria-hidden="true" className="size-4 shrink-0" />
									{option.label}
								</span>
							</Menu.Item>
						</SharedLayoutItem>
					</Liquid.Item>
				))}
			</Liquid>
		</SharedLayoutGroup>
	);
}
