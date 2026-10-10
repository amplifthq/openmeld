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

const integrations = PLUGINS.filter(
	(plugin) => plugin.availability === "available"
);

// Several shipped connections share one brand. Keep every connection in the
// details, but show its logo only once per marquee group.
const brands = [...new Set(integrations.map((plugin) => plugin.logoPath))].map(
	(logoPath) => {
		const plugins = integrations.filter(
			(plugin) => plugin.logoPath === logoPath
		);
		const app = plugins[0];
		const name = app.service.startsWith("cloudflare_")
			? "Cloudflare"
			: plugins.map((plugin) => plugin.name).join(" / ");
		return { app, name };
	}
);

function LogoGroup({ reverse = false }: { reverse?: boolean }) {
	const ordered = reverse ? [...brands].reverse() : brands;
	return (
		<div className="meld-connectors-group">
			{ordered.map((brand) => (
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
					Your tools.
					<span> Connected.</span>
				</h2>
				<p>
					Connect your personal tools or your team's apps. Let your agents work
					with documents, customer records, analytics, and deployments through
					the access you grant.
				</p>
			</div>
			<p className="sr-only">
				Supported integrations: {integrations.map((app) => app.name).join(", ")}
				.
			</p>
			<div aria-hidden="true" className="meld-connectors-wall">
				<div className="meld-connectors-track">
					<LogoGroup />
					<LogoGroup />
				</div>
				<div className="meld-connectors-track meld-connectors-track-reverse">
					<LogoGroup reverse />
					<LogoGroup reverse />
				</div>
			</div>
			<div className="meld-connectors-footer">
				<p>{integrations.length} supported integrations. More on the way.</p>
				<Sheet>
					<SheetTrigger className="meld-connectors-details">
						See all integrations <PlusIcon aria-hidden size={14} />
					</SheetTrigger>
					<SheetContent className="dark meld-connectors-sheet">
						<SheetHeader>
							<SheetTitle>Supported integrations</SheetTitle>
							<SheetDescription>
								Connect these apps from Plugins in OpenMeld. Personal accounts
								stay private. Choose which agents can use each connection.
							</SheetDescription>
						</SheetHeader>
						<ul className="meld-connectors-list">
							{integrations.map((app) => (
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
