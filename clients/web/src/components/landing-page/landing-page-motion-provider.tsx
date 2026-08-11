import { domAnimation, LazyMotion } from "motion/react";
import type { ReactNode } from "react";

export function LandingMotionProvider({ children }: { children: ReactNode }) {
	return (
		<LazyMotion features={domAnimation} strict>
			{children}
		</LazyMotion>
	);
}
