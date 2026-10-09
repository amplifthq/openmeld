import { BorderBeam } from "@openmeld/ui/components/border-beam";
import { useMediaQuery } from "@openmeld/ui/hooks/use-media-query";
import { useInView } from "motion/react";
import { type ReactNode, useEffect, useRef, useState } from "react";

const beamCss = `
[data-beam="{id}"] { --beam-stroke-opacity: 2; }
[data-beam="{id}"][data-active] {
  animation-iteration-count: 1, 1;
  animation-fill-mode: forwards, forwards;
}
[data-beam="{id}"]::before { display: none; }
[data-beam="{id}"][data-cue-paused]:is([data-active], [data-fading]) {
  animation-play-state: paused;
}
@media (prefers-reduced-motion: reduce) {
  [data-beam="{id}"][data-fading] {
    animation-name: beam-fade-out-{id};
    animation-duration: 0.2s;
  }
}
`;

/** A one-time invitation to send the demo's draft, never a product behavior. */
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
	const [noticed, setNoticed] = useState(false);
	const eligible = hasDraft && !sending && !noticed;
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
			colorVariant="ocean"
			css={beamCss}
			data-cue-paused={!inView || hidden ? "" : undefined}
			data-reduced-cue={eligible && reducedMotion ? "" : undefined}
			duration={8}
			glowSize={0.5}
			onAnimationEnd={(event) => {
				if (event.animationName.startsWith("beam-spin-")) {
					setNoticed(true);
				}
			}}
			onFocusCapture={() => setNoticed(true)}
			ref={ref}
			size="md"
			staticColors
			strength={0.6}
			theme={
				document.documentElement.classList.contains("dark") ? "dark" : "light"
			}
		>
			{children}
		</BorderBeam>
	);
}
