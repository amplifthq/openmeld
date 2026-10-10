import { PLUGINS } from "@openmeld/product-catalog/plugins";
import { AppLogo } from "@openmeld/ui/components/app-logo";
import { Button } from "@openmeld/ui/components/button";
import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetHeader,
	SheetTitle,
	SheetTrigger,
} from "@openmeld/ui/components/sheet";
import { useMediaQuery } from "@openmeld/ui/hooks/use-media-query";
import { PauseIcon, PlayIcon, PlusIcon } from "@phosphor-icons/react";
import { useInView } from "motion/react";
import { useEffect, useRef, useState } from "react";
import "./connector-showcase.css";

const plugins = PLUGINS.filter((plugin) => plugin.availability === "available");
const roundedPluginCount = Math.floor(plugins.length / 10) * 10;
const sharedBrandNames: Record<string, string> = {
	"/app-logos/cloudflare.svg": "Cloudflare",
	"/app-logos/alibaba-cloud.svg": "Alibaba Cloud",
	"/app-logos/outlook.svg": "Outlook",
};

// Several shipped connections share one brand. Keep every connection in the
// details, but show its logo in only one marquee row.
const brands = [...new Set(plugins.map((plugin) => plugin.logoPath))].map(
	(logoPath) => {
		const brandPlugins = plugins.filter(
			(plugin) => plugin.logoPath === logoPath
		);
		const app = brandPlugins[0];
		const name =
			sharedBrandNames[logoPath] ??
			brandPlugins.map((plugin) => plugin.name).join(" / ");
		return { app, name };
	}
);

const brandRows = [
	brands.filter((_, index) => index % 2 === 0),
	brands.filter((_, index) => index % 2 === 1).reverse(),
];

function LogoGroup({ items }: { items: typeof brands }) {
	return (
		<div className="meld-connectors-group">
			{items.map((brand) => (
				<div className="meld-connector-tile" key={brand.app.logoPath}>
					<AppLogo
						app={brand.app}
						className="meld-connector-logo"
						size="lg"
						surfaceLevel={1}
					/>
					<span>{brand.name}</span>
				</div>
			))}
		</div>
	);
}

export function ConnectorShowcase() {
	const ref = useRef<HTMLDivElement>(null);
	const inView = useInView(ref);
	const reduced = useMediaQuery("(prefers-reduced-motion: reduce)");
	const [paused, setPaused] = useState(false);
	const [pageVisible, setPageVisible] = useState(false);
	useEffect(() => {
		const update = () => setPageVisible(!document.hidden);
		update();
		document.addEventListener("visibilitychange", update);
		return () => document.removeEventListener("visibilitychange", update);
	}, []);
	return (
		<div
			className="meld-connectors-panel"
			data-running={inView && pageVisible && !reduced && !paused}
			ref={ref}
		>
			<div className="meld-connectors-copy">
				<h2 id="connectors-title">
					{roundedPluginCount}+ plugins.
					<br />
					<span>One connected team.</span>
				</h2>
				<p>
					Your Center Agent, local and remote agents, and teammates work
					together across your existing tools. You control access.
				</p>
			</div>
			<p className="sr-only">
				Supported plugins: {plugins.map((app) => app.name).join(", ")}.
			</p>
			<div aria-hidden="true" className="meld-connectors-wall">
				<div className="meld-connectors-track">
					<LogoGroup items={brandRows[0]} />
					<LogoGroup items={brandRows[0]} />
				</div>
				<div className="meld-connectors-track meld-connectors-track-reverse">
					<LogoGroup items={brandRows[1]} />
					<LogoGroup items={brandRows[1]} />
				</div>
			</div>
			<div className="meld-connectors-footer">
				<p>More plugins on the way.</p>
				<Sheet>
					<SheetTrigger className="meld-connectors-details">
						See all plugins <PlusIcon aria-hidden size={14} />
					</SheetTrigger>
					<SheetContent className="dark meld-connectors-sheet">
						<SheetHeader>
							<SheetTitle>Supported plugins</SheetTitle>
							<SheetDescription>
								Connect these apps from Plugins in OpenMeld. Personal accounts
								stay private. Choose which agents can use each connection.
							</SheetDescription>
						</SheetHeader>
						<ul className="meld-connectors-list">
							{plugins.map((app) => (
								<li key={app.service}>
									<AppLogo app={app} size="md" />
									<div>
										<h3>{app.name}</h3>
										<p>{app.description}</p>
									</div>
								</li>
							))}
						</ul>
					</SheetContent>
				</Sheet>
			</div>
			{!reduced && (
				<Button
					aria-label={paused ? "Play logo animation" : "Pause logo animation"}
					className="meld-connectors-motion"
					onClick={() => setPaused((current) => !current)}
					size="icon"
					title={paused ? "Play logo animation" : "Pause logo animation"}
					variant="ghost"
				>
					{paused ? <PlayIcon aria-hidden /> : <PauseIcon aria-hidden />}
				</Button>
			)}
		</div>
	);
}
