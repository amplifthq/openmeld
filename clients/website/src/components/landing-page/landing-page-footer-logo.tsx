"use client";

import {
	domAnimation,
	LazyMotion,
	useMotionValue,
	useReducedMotion,
	useSpring,
	useTransform,
} from "motion/react";
import { linearGradient as MotionLinearGradient } from "motion/react-m";
import { type PointerEvent as ReactPointerEvent, useId } from "react";

const FOOTER_LOGO_VIEWBOX_WIDTH = 1600;
const FOOTER_LOGO_VIEWBOX_HEIGHT = 300;
const FOOTER_LOGO_RESTING_POSITION = 0.5;

export function LandingPageFooterLogo() {
	const gradientId = `${useId().replaceAll(":", "")}-landing-footer-gradient`;
	const gradientPosition = useMotionValue(FOOTER_LOGO_RESTING_POSITION);
	const gradientX1 = useSpring(
		useTransform(gradientPosition, [0, 1], [0, FOOTER_LOGO_VIEWBOX_WIDTH]),
		{
			damping: 25,
			stiffness: 150,
		}
	);
	const shouldReduceMotion = useReducedMotion();

	const updateGradientPosition = (event: ReactPointerEvent<HTMLDivElement>) => {
		if (shouldReduceMotion) {
			return;
		}

		const bounds = event.currentTarget.getBoundingClientRect();
		const pointerPosition = (event.clientX - bounds.left) / bounds.width;
		gradientPosition.set(Math.min(1, Math.max(0, pointerPosition)));
	};

	const resetGradientPosition = () => {
		if (!shouldReduceMotion) {
			gradientPosition.set(FOOTER_LOGO_RESTING_POSITION);
		}
	};

	return (
		<div
			aria-hidden="true"
			className="relative h-[clamp(7.5rem,18.75vw,30rem)] w-full overflow-hidden text-foreground after:absolute after:bottom-0 after:h-px after:w-full after:bg-current/15"
			data-testid="landing-footer-fluid-logo"
			onPointerDown={updateGradientPosition}
			onPointerLeave={resetGradientPosition}
			onPointerMove={updateGradientPosition}
		>
			<LazyMotion features={domAnimation} strict>
				<svg
					className="size-full translate-y-[37.5%] select-none"
					fill="none"
					viewBox={`0 0 ${FOOTER_LOGO_VIEWBOX_WIDTH} ${FOOTER_LOGO_VIEWBOX_HEIGHT}`}
					xmlns="http://www.w3.org/2000/svg"
				>
					<title>Decorative OpenMeld fluid gradient logo</title>
					<text
						dominantBaseline="central"
						fill={`url(#${gradientId})`}
						fontSize={FOOTER_LOGO_VIEWBOX_HEIGHT}
						fontWeight="bold"
						stroke="currentColor"
						strokeOpacity="0.1"
						strokeWidth="2"
						style={{
							fontFamily: "Helvetica, Arial, sans-serif",
						}}
						textAnchor="middle"
						x="50%"
						y="50%"
					>
						OpenMeld
					</text>
					<defs>
						<MotionLinearGradient
							gradientUnits="userSpaceOnUse"
							id={gradientId}
							x1={
								shouldReduceMotion
									? FOOTER_LOGO_VIEWBOX_WIDTH * FOOTER_LOGO_RESTING_POSITION
									: gradientX1
							}
							x2={FOOTER_LOGO_VIEWBOX_WIDTH / 2}
							y1="0"
							y2={FOOTER_LOGO_VIEWBOX_HEIGHT}
						>
							<stop offset="0.625" stopColor="currentColor" stopOpacity="0" />
							<stop offset="1" stopColor="currentColor" />
						</MotionLinearGradient>
					</defs>
				</svg>
			</LazyMotion>
		</div>
	);
}
