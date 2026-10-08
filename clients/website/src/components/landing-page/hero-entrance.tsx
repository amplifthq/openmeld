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
		>
			{children}
		</section>
	);
}
