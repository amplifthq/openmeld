import { motion, type Transition } from "framer-motion";
import { memo } from "react";

const CIRCLE_A_PATH =
	"M 12 8 C 14.21 8 16 9.79 16 12 C 16 14.21 14.21 16 12 16 C 9.79 16 8 14.21 8 12 C 8 9.79 9.79 8 12 8 Z";
const INFINITY_PATH =
	"M 12 12 C 14 8.5 19 8.5 19 12 C 19 15.5 14 15.5 12 12 C 10 8.5 5 8.5 5 12 C 5 15.5 10 15.5 12 12 Z";
const CIRCLE_B_PATH =
	"M 12 16 C 14.21 16 16 14.21 16 12 C 16 9.79 14.21 8 12 8 C 9.79 8 8 9.79 8 12 C 8 14.21 9.79 16 12 16 Z";
const MOBIUS_PATH_ANIMATION = [
	CIRCLE_A_PATH,
	INFINITY_PATH,
	CIRCLE_B_PATH,
	INFINITY_PATH,
	CIRCLE_A_PATH,
];
const MOBIUS_PATH_TRANSITION: Transition = {
	d: {
		duration: 6,
		ease: "easeInOut",
		repeat: Number.POSITIVE_INFINITY,
		times: [0, 0.25, 0.5, 0.75, 1],
	},
};

export const AnimatedMobiusIcon = memo(function AnimatedMobiusIcon() {
	return (
		<motion.svg
			aria-hidden="true"
			className="shrink-0 text-muted-foreground"
			data-slot="animated-mobius-icon"
			fill="none"
			height={16}
			stroke="currentColor"
			strokeLinecap="round"
			strokeLinejoin="round"
			strokeWidth={1.5}
			viewBox="0 0 24 24"
			width={16}
		>
			<motion.path
				animate={{
					d: MOBIUS_PATH_ANIMATION,
				}}
				d={CIRCLE_A_PATH}
				initial={{ d: CIRCLE_A_PATH }}
				transition={MOBIUS_PATH_TRANSITION}
			/>
		</motion.svg>
	);
});
