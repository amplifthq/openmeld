import { FluidNavMenuItem } from "@openmeld/ui/fluid/nav-menu";
import { springs } from "@openmeld/ui/lib/springs";
import { motion, useReducedMotion } from "framer-motion";
import {
	type ComponentProps,
	createContext,
	type ReactNode,
	useContext,
} from "react";

export const AgentGroupContext = createContext<readonly string[] | null>(null);
const MotionNavItem = motion.create(FluidNavMenuItem);

export function AgentGroupItem(props: ComponentProps<typeof MotionNavItem>) {
	const group = useContext(AgentGroupContext);
	const reduce = useReducedMotion();
	return (
		<MotionNavItem
			{...props}
			layout={group && !reduce ? "position" : false}
			transition={springs.slow}
		/>
	);
}

export function AgentGroupAvatar({
	profileId,
	children,
}: {
	profileId: string;
	children: ReactNode;
}) {
	const previews = useContext(AgentGroupContext);
	const reduce = useReducedMotion();
	return (
		<motion.span
			className="relative inline-flex shrink-0"
			layoutId={
				!reduce && previews?.includes(profileId)
					? `agent-avatar-${profileId}`
					: undefined
			}
			transition={springs.slow}
		>
			{children}
		</motion.span>
	);
}
