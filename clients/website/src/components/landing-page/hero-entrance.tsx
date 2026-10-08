import { type ReactNode, useEffect, useState } from "react";

// Start after hydration, rather than spending the reveal while the browser is
// still loading fonts and modules. CSS owns every frame of the entrance.
export function HeroEntrance({ children }: { children: ReactNode }) {
	const [ready, setReady] = useState(false);
	useEffect(() => setReady(true), []);
	return (
		<section
			aria-labelledby="hero-title"
			className="meld-hero meld-wrap"
			data-hero-ready={ready ? "" : undefined}
			onFocusCapture={(event) => {
				const group = event.target.closest(".meld-actions, .meld-open-source");
				if (group?.parentElement !== event.currentTarget) {
					return;
				}
				// Finish the existing timeline. Removing its CSS declaration on focus
				// would create a new entrance when focus moves to a menu or the page.
				for (const animation of group.getAnimations()) {
					animation.finish();
				}
			}}
		>
			{children}
		</section>
	);
}
