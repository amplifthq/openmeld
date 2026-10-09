import { useInView } from "motion/react";
import { lazy, Suspense, useRef } from "react";
import "./landing-figure.css";

const figures = {
	terminal: lazy(() =>
		import("@lucasmarkes/hairline/react").then(({ Terminal }) => ({
			default: Terminal,
		}))
	),
	riffle: lazy(() =>
		import("@lucasmarkes/hairline/react").then(({ Riffle }) => ({
			default: Riffle,
		}))
	),
	turntable: lazy(() =>
		import("@lucasmarkes/hairline/react").then(({ Turntable }) => ({
			default: Turntable,
		}))
	),
	lockers: lazy(() =>
		import("@lucasmarkes/hairline/react").then(({ Lockers }) => ({
			default: Lockers,
		}))
	),
	branches: lazy(() =>
		import("@lucasmarkes/hairline/react").then(({ Branches }) => ({
			default: Branches,
		}))
	),
};

export function LandingFigure({
	figure,
	label,
}: {
	figure: keyof typeof figures;
	label: string;
}) {
	const ref = useRef<HTMLDivElement>(null);
	const nearViewport = useInView(ref, { once: true, margin: "300px 0px" });
	const Figure = figures[figure];
	return (
		<div className="meld-figure" ref={ref}>
			{nearViewport && (
				<Suspense fallback={null}>
					<Figure intensity={0.35} label={label} theme="dark" />
				</Suspense>
			)}
		</div>
	);
}
