import { buttonVariants } from "@openmeld/ui/components/button";
import {
	OpenMeldLogoStrong,
	type OpenMeldLogoStrongAppearance,
} from "@openmeld/ui/components/openmeld-logo-strong";
import { ArrowRightIcon } from "@phosphor-icons/react";
import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { PublicPageHeader } from "#/components/app/public-page-header";
import { LOCAL_AGENTS_GUIDE_PATH } from "#/lib/local-agent-install-guides";
import { LandingPageFooterLogo } from "./landing-page-footer-logo";
import {
	LANDING_PAGE_HERO_HEADING,
	LANDING_PAGE_HERO_TAGLINE,
	LandingPageHeroSubtitle,
	SlackMarkIcon,
} from "./landing-page-hero-copy";
import { LandingPageHeroShaderBackground } from "./landing-page-hero-shader-background";
import { LandingPageNarrative } from "./landing-page-narrative";

const LANDING_LOGO_FONT_SIZE = "clamp(0.29rem,0.65vw,0.52rem)";
const LANDING_LOGO_LIGHT_APPEARANCE = {
	baseOpacity: 0.12,
	fillMinOpacity: 0.44,
	glowBlurPx: 8,
	glowMaxOpacity: 0.32,
	influenceContrast: 1.8,
	strokeBrightness: 1,
	strokeOpacity: 0.28,
} satisfies OpenMeldLogoStrongAppearance;
const LANDING_CONTENT_CLASS_NAME =
	"mx-auto w-full max-w-[82rem] px-6 sm:px-10 lg:px-16";
const AGENT_INTERFACE_PATH = "/agent-interface";
const HERO_SHADER_FILTER_STYLE = {
	background: [
		"radial-gradient(ellipse 38rem 30rem at 28% 50%, color-mix(in oklab, var(--background) 98%, transparent) 0, color-mix(in oklab, var(--background) 93%, transparent) 46%, color-mix(in oklab, var(--background) 70%, transparent) 66%, transparent 86%)",
		"radial-gradient(ellipse 34rem 36rem at 77% 42%, color-mix(in oklab, var(--background) 94%, transparent) 0, color-mix(in oklab, var(--background) 82%, transparent) 52%, transparent 84%)",
		"linear-gradient(90deg, color-mix(in oklab, var(--background) 48%, transparent) 0%, transparent 32%, transparent 68%, color-mix(in oklab, var(--background) 46%, transparent) 100%)",
	].join(", "),
};

type LandingPageProps = {
	authenticatedEntryPath: string | null;
};

export function LandingPage({ authenticatedEntryPath }: LandingPageProps) {
	const appEntryPath = authenticatedEntryPath ?? "/login";
	const isHeaderOnInverseSurface = useLandingHeaderOnInverseSurface();

	return (
		<>
			<main className="landing-copy-weight relative z-10 min-h-svh bg-background">
				<PublicPageHeader
					appEntryClassName={
						isHeaderOnInverseSurface
							? "!border-background/30 !bg-foreground/78 !text-background backdrop-blur-md hover:!border-background/45 hover:!bg-foreground/90 hover:!text-background"
							: "!border-foreground/30 !bg-background/78 !text-foreground backdrop-blur-md hover:!border-foreground/45 hover:!bg-background/90 hover:!text-foreground"
					}
					appEntryLabel={authenticatedEntryPath ? "Enter" : undefined}
					appEntryPath={appEntryPath}
					brandLinkClassName={
						isHeaderOnInverseSurface
							? "!border-0 bg-foreground/78 px-3 py-2 backdrop-blur-md [&_span]:!text-background"
							: "!border-0 bg-background/78 px-3 py-2 backdrop-blur-md [&_span]:!text-foreground"
					}
					className={
						isHeaderOnInverseSurface
							? "!border-0 !border-b-0 !bg-transparent !backdrop-blur-none fixed inset-x-0 top-0 z-50 text-background transition-colors duration-200"
							: "!border-0 !border-b-0 !bg-transparent !backdrop-blur-none fixed inset-x-0 top-0 z-50 text-foreground transition-colors duration-200"
					}
				/>
				<LandingPageHero appEntryPath={appEntryPath} />
				<LandingPageNarrative appEntryPath={appEntryPath} />
			</main>
			<LandingPageFooter />
		</>
	);
}

function useLandingHeaderOnInverseSurface() {
	const [isOnInverseSurface, setIsOnInverseSurface] = useState(false);

	useEffect(() => {
		const inverseSection = document.getElementById("agent-activity");
		if (!inverseSection) {
			return;
		}

		let frameId: number | null = null;
		const measure = () => {
			frameId = null;
			const rectangle = inverseSection.getBoundingClientRect();
			const headerProbeY = 28;
			setIsOnInverseSurface(
				rectangle.top <= headerProbeY && rectangle.bottom >= headerProbeY
			);
		};
		const scheduleMeasurement = () => {
			if (frameId === null) {
				frameId = window.requestAnimationFrame(measure);
			}
		};

		measure();
		window.addEventListener("resize", scheduleMeasurement);
		window.addEventListener("scroll", scheduleMeasurement, { passive: true });

		return () => {
			if (frameId !== null) {
				window.cancelAnimationFrame(frameId);
			}
			window.removeEventListener("resize", scheduleMeasurement);
			window.removeEventListener("scroll", scheduleMeasurement);
		};
	}, []);

	return isOnInverseSurface;
}

function LandingPageHero({ appEntryPath }: { appEntryPath: string }) {
	return (
		<section
			className="relative overflow-hidden"
			data-testid="landing-hero-section"
		>
			<LandingPageHeroShaderBackground />
			<div
				aria-hidden="true"
				className="pointer-events-none absolute inset-0 z-[1]"
				data-testid="landing-hero-shader-filter"
				style={HERO_SHADER_FILTER_STYLE}
			/>
			<div
				className={`${LANDING_CONTENT_CLASS_NAME} relative grid min-h-svh items-center gap-16 py-20 lg:grid-cols-12 lg:py-24`}
				data-testid="landing-hero-content-grid"
			>
				<div className="relative z-10 flex flex-col items-center text-center lg:col-span-6 lg:items-start lg:text-left">
					<OpenMeldLogoStrong
						className="mx-auto text-foreground lg:mx-0"
						lightAppearance={LANDING_LOGO_LIGHT_APPEARANCE}
						size={LANDING_LOGO_FONT_SIZE}
					/>
					<h1 className="landing-display-tight mt-8 max-w-3xl text-balance font-geist-pixel-square font-medium text-[clamp(2.5rem,3.75vw,3.75rem)] text-foreground leading-[0.96]">
						{LANDING_PAGE_HERO_HEADING}
					</h1>
					<p
						className="mt-6 max-w-sm text-pretty text-base text-muted-foreground leading-7 sm:text-lg"
						data-testid="landing-hero-tagline"
					>
						{LANDING_PAGE_HERO_TAGLINE}
					</p>
					<div className="mt-9 flex flex-wrap justify-center gap-3 lg:justify-start">
						<Link
							className={buttonVariants({
								className: "h-11 gap-2 rounded-md px-5 text-sm",
							})}
							to={appEntryPath}
						>
							Start with your Center Agent
							<ArrowRightIcon aria-hidden className="size-4" />
						</Link>
						<Link
							className={buttonVariants({
								className:
									"h-11 gap-2 rounded-md px-5 text-sm shadow-surface-2",
								variant: "secondary",
							})}
							to="/add-to-slack"
						>
							<SlackMarkIcon className="size-4" />
							Add to Slack
						</Link>
					</div>
				</div>

				<LandingPageHeroSubtitle className="relative z-10 mx-auto max-w-lg text-pretty text-center text-base text-muted-foreground leading-8 lg:col-span-4 lg:col-start-9 lg:mx-0 lg:max-w-md lg:text-left" />
			</div>
		</section>
	);
}

function LandingPageFooter() {
	return (
		<footer className="landing-copy-weight sticky bottom-0 z-0 flex min-h-[24rem] flex-col overflow-hidden bg-muted/80">
			<div className={`${LANDING_CONTENT_CLASS_NAME} pt-12 sm:pt-16`}>
				<div className="flex flex-col gap-8 text-muted-foreground text-sm md:flex-row md:items-start md:justify-between">
					<div className="max-w-sm">
						<p className="font-medium text-foreground">OpenMeld</p>
						<p className="mt-2 text-muted-foreground/80 text-xs leading-5">
							<span
								className="font-medium text-amber-600 dark:text-amber-400"
								data-testid="landing-footer-experimental"
							>
								Experimental
							</span>{" "}
							software for people and local agents working as one team.
						</p>
					</div>
					<nav aria-label="Footer">
						<ul className="flex flex-wrap gap-x-6 gap-y-3">
							<li>
								<Link className="hover:text-foreground" to="/changelog">
									Changelog
								</Link>
							</li>
							<li>
								<Link
									className="hover:text-foreground"
									to={AGENT_INTERFACE_PATH}
								>
									Guide for your agents
								</Link>
							</li>
							<li>
								<Link
									className="hover:text-foreground"
									to={LOCAL_AGENTS_GUIDE_PATH}
								>
									Install local agents
								</Link>
							</li>
							<li>
								<Link className="hover:text-foreground" to="/privacy">
									Privacy
								</Link>
							</li>
							<li>
								<Link className="hover:text-foreground" to="/terms">
									Terms
								</Link>
							</li>
						</ul>
					</nav>
				</div>
			</div>
			<div className="mt-auto w-full">
				<LandingPageFooterLogo />
			</div>
		</footer>
	);
}
