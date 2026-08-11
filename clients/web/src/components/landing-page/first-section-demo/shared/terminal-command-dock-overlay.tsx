import { motion } from "framer-motion";

import { TerminalCommandText } from "./terminal-command-text";

type TerminalCommandDockOverlayProps = {
	command: string;
	onComplete: () => void;
	sourceHeight: number;
	sourceLeft: number;
	sourceTop: number;
	sourceWidth: number;
	targetLeft: number;
	targetTop: number;
};

export function TerminalCommandDockOverlay({
	command,
	onComplete,
	sourceHeight,
	sourceLeft,
	sourceTop,
	sourceWidth,
	targetLeft,
	targetTop,
}: TerminalCommandDockOverlayProps) {
	return (
		<motion.div
			animate={{
				x: targetLeft,
				y: targetTop,
			}}
			className="pointer-events-none absolute top-0 left-0 z-30 overflow-hidden will-change-transform"
			initial={{
				x: sourceLeft,
				y: sourceTop,
			}}
			onAnimationComplete={onComplete}
			style={{
				height: sourceHeight,
				width: sourceWidth,
			}}
			transition={{
				duration: 0.32,
				ease: [0.22, 1, 0.36, 1],
			}}
		>
			<TerminalCommandText
				className="text-[0.95rem] sm:text-[1rem]"
				command={command}
			/>
		</motion.div>
	);
}
