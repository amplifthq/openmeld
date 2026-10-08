import { FluidHoverHighlight } from "@openmeld/ui/fluid/fluid-hover-highlight";
import {
	useFluidHover,
	useRegisterFluidHoverItem,
} from "@openmeld/ui/hooks/use-fluid-hover";
import { useRef } from "react";

const links = [
	{ href: "/#product", label: "Product" },
	{ href: "/#agents", label: "Agents" },
	{ href: "/downloads", label: "Downloads" },
	{ href: "https://docs.openmeld.ai", label: "Docs" },
	{ href: "/changelog", label: "Changelog" },
];

export function PublicPageNavigation() {
	const ref = useRef<HTMLDivElement>(null);
	const hover = useFluidHover(ref, { axis: "xy", gapClick: false });
	return (
		<nav
			aria-label="Main navigation"
			className="max-sm:col-span-2 max-sm:row-start-2"
		>
			{/* biome-ignore lint/a11y/noNoninteractiveElementInteractions: Pointer motion controls only the shared decorative highlight. */}
			{/* biome-ignore lint/a11y/noStaticElementInteractions: Native links own activation and keyboard focus. */}
			<div
				className="relative flex flex-wrap gap-0.5 max-sm:flex-nowrap max-sm:justify-between"
				onMouseEnter={hover.handlers.onMouseEnter}
				onMouseLeave={hover.handlers.onMouseLeave}
				onMouseMove={hover.handlers.onMouseMove}
				ref={ref}
			>
				<FluidHoverHighlight
					className="rounded-md bg-interaction-hover"
					hover={hover}
				/>
				{links.map((link, index) => (
					<NavigationLink
						index={index}
						key={link.href}
						link={link}
						registerItem={hover.registerItem}
					/>
				))}
			</div>
		</nav>
	);
}

function NavigationLink({
	link,
	index,
	registerItem,
}: {
	link: (typeof links)[number];
	index: number;
	registerItem: ReturnType<typeof useFluidHover>["registerItem"];
}) {
	const ref = useRef<HTMLAnchorElement>(null);
	useRegisterFluidHoverItem(registerItem, index, ref);
	return (
		<a
			className="relative z-10 block px-3 py-2.5 text-[13px] text-muted-foreground hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2 max-sm:px-1 max-sm:text-xs"
			href={link.href}
			ref={ref}
		>
			{link.label}
		</a>
	);
}
