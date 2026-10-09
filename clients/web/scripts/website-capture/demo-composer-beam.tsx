import { BorderBeam } from "@openmeld/ui/components/border-beam";
import { useMediaQuery } from "@openmeld/ui/hooks/use-media-query";
import { useInView } from "motion/react";
import { type ReactNode, useEffect, useRef, useState } from "react";

const beamCss = `
[data-beam="{id}"] {
  --beam-stroke-opacity: 4.5;
  --beam-inner-opacity: 0.5;
}
[data-beam="{id}"][data-cue-paused]:is([data-active], [data-fading]) {
  animation-play-state: paused;
}
@media (prefers-reduced-motion: reduce) {
  [data-beam="{id}"][data-fading] {
    animation: beam-fade-out-{id} 0.2s ease forwards;
  }
}
`;

/** Highlight a sendable demo draft until the visitor starts interacting. */
export function DemoComposerBeam({
	children,
	hasDraft,
	sending,
}: {
	children: ReactNode;
	hasDraft: boolean;
	sending: boolean;
}) {
	const ref = useRef<HTMLDivElement>(null);
	const inView = useInView(ref, { amount: 0.8 });
	const reducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
	const [hidden, setHidden] = useState(document.hidden);
	const [focused, setFocused] = useState(false);
	const eligible = hasDraft && !sending && !focused;
	useEffect(() => {
		const update = () => setHidden(document.hidden);
		document.addEventListener("visibilitychange", update);
		return () => document.removeEventListener("visibilitychange", update);
	}, []);

	return (
		<BorderBeam
			active={eligible && !reducedMotion}
			borderRadius={18}
			className="demo-composer-beam"
			colorVariant="colorful"
			css={beamCss}
			data-cue-paused={!inView || hidden ? "" : undefined}
			data-reduced-cue={eligible && reducedMotion ? "" : undefined}
			duration={10}
			glowSize={0.6}
			onBlurCapture={(event) => {
				if (!event.currentTarget.contains(event.relatedTarget)) {
					setFocused(false);
				}
			}}
			onFocusCapture={() => setFocused(true)}
			ref={ref}
			size="md"
			staticColors
			strength={0.85}
			theme={
				document.documentElement.classList.contains("dark") ? "dark" : "light"
			}
		>
			{children}
		</BorderBeam>
	);
}
