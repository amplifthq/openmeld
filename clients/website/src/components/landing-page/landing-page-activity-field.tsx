import { LandingActivityLanes } from "./landing-page-activity-lanes";
import { LandingAsciiCanvas } from "./landing-page-ascii-canvas";

export function LandingAgentActivityField() {
	return (
		<div
			aria-hidden="true"
			className="relative mt-12 h-[17rem] overflow-hidden sm:mt-14 sm:h-[20rem]"
			data-testid="landing-agent-activity-field"
		>
			<LandingAsciiCanvas
				className="text-background"
				scene="activity-field"
				testId="landing-agent-activity-canvas"
			/>
			<div className="pointer-events-none absolute inset-0 bg-[linear-gradient(90deg,var(--foreground),transparent_12%,transparent_88%,var(--foreground)),linear-gradient(180deg,var(--foreground),transparent_16%,transparent_82%,var(--foreground))]" />
			<LandingActivityLanes />
		</div>
	);
}
