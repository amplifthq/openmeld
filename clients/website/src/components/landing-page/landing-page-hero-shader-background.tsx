import { LandingAsciiCanvas } from "./landing-page-ascii-canvas";

export function LandingPageHeroShaderBackground() {
	return (
		<div
			aria-hidden="true"
			className="pointer-events-none absolute inset-0 z-0 opacity-[0.82] mix-blend-multiply dark:opacity-[0.96] dark:mix-blend-screen"
			data-testid="landing-hero-shader"
		>
			<LandingAsciiCanvas
				className="text-foreground"
				scene="collaboration-loop"
				testId="landing-hero-ascii-canvas"
			/>
		</div>
	);
}
