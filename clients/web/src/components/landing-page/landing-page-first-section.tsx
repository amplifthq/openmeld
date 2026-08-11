import {
	APP_PAGE_FRAME_CLASS_NAME,
	APP_PAGE_FRAME_PADDING_CLASS_NAME,
} from "#/components/app/shell-layout";
import { DemoPlayer } from "./first-section-demo/demo-player";
import {
	LANDING_PAGE_HERO_HEADING,
	LandingPageHeroSubtitle,
} from "./landing-page-hero-copy";

export function LandingPageFirstSection() {
	return (
		<section
			className={`mx-auto flex w-full flex-col gap-10 py-20 lg:gap-12 ${APP_PAGE_FRAME_PADDING_CLASS_NAME} ${APP_PAGE_FRAME_CLASS_NAME}`}
		>
			<div className="space-y-4">
				<h1 className="text-balance font-geist-pixel-square font-medium text-2xl sm:text-3xl lg:text-4xl">
					{LANDING_PAGE_HERO_HEADING}
				</h1>
				<LandingPageHeroSubtitle className="max-w-2xl text-pretty text-muted-foreground text-sm leading-6 sm:text-base" />
			</div>

			<DemoPlayer />
		</section>
	);
}
