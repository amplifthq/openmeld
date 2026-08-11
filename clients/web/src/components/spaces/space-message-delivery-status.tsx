import { cn } from "@openmeld/ui/lib/utils";
import {
	ClockClockwiseIcon,
	StopCircleIcon,
	WarningCircleIcon,
} from "@phosphor-icons/react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
	resolveSpaceMessageDeliveryStatusText,
	type SpaceMessageDeliveryPresentation,
} from "#/lib/spaces/message-state";
import { AnimatedMobiusIcon } from "./animated-mobius-icon";
import { Marker, MarkerContent, MarkerIcon } from "./primitives/marker";
import { SpaceAgentOrb } from "./space-agent-orb";

const AGENT_STATUS_ENTER_TRANSITION = {
	duration: 0.24,
	ease: [0.16, 1, 0.3, 1],
} as const;
const AGENT_STATUS_EXIT = {
	filter: "blur(8px)",
	opacity: 0,
	y: "-80%",
	transition: {
		duration: 0.16,
		ease: [0.7, 0, 0.84, 0],
	},
} as const;
const AGENT_STATUS_INITIAL = {
	filter: "blur(8px)",
	opacity: 0,
	y: "80%",
} as const;
const AGENT_STATUS_VISIBLE = {
	filter: "blur(0px)",
	opacity: 1,
	y: 0,
} as const;

export function SpaceMessageDeliveryStatus(input: {
	align?: "start" | "end";
	className?: string;
	presentation: SpaceMessageDeliveryPresentation | null;
}) {
	const presentation = input.presentation;
	if (!presentation) {
		return null;
	}
	const statusText = resolveSpaceMessageDeliveryStatusText(presentation);

	if (!statusText) {
		return null;
	}
	const animateAgentStatus =
		presentation === "agent_sending" || presentation === "agent_starting";

	return (
		<Marker
			aria-atomic="true"
			aria-label={statusText}
			className={cn(
				"w-fit gap-2 text-muted-foreground",
				input.align === "end" ? "ml-auto text-right" : null,
				input.className
			)}
			data-align={input.align ?? "start"}
			data-space-message-delivery-status=""
			role="status"
		>
			<MarkerIcon className="flex size-4 items-center justify-center">
				{renderDeliveryStatusIcon(presentation)}
			</MarkerIcon>
			<MarkerContent className="text-[13px]">
				{animateAgentStatus ? (
					<AnimatedAgentStatusText text={statusText} />
				) : (
					statusText
				)}
			</MarkerContent>
		</Marker>
	);
}

function AnimatedAgentStatusText(input: { text: string }) {
	const shouldReduceMotion = useReducedMotion() === true;

	return (
		<span aria-hidden="true" className="inline-grid">
			<AnimatePresence initial={false} mode="popLayout">
				<motion.span
					animate={AGENT_STATUS_VISIBLE}
					aria-hidden="true"
					className="col-start-1 row-start-1 inline-block whitespace-nowrap"
					data-slot="space-message-delivery-status-text"
					exit={shouldReduceMotion ? undefined : AGENT_STATUS_EXIT}
					initial={shouldReduceMotion ? false : AGENT_STATUS_INITIAL}
					key={input.text}
					transition={
						shouldReduceMotion ? { duration: 0 } : AGENT_STATUS_ENTER_TRANSITION
					}
				>
					{input.text}
				</motion.span>
			</AnimatePresence>
		</span>
	);
}

function renderDeliveryStatusIcon(
	presentation: SpaceMessageDeliveryPresentation
) {
	switch (presentation) {
		case "agent_sending":
		case "agent_starting":
			return <AnimatedMobiusIcon />;
		case "agent_streaming":
			return <SpaceAgentOrb data-testid="agent-working-orb" />;
		case "agent_stream_failed":
		case "agent_stream_publish_failed":
			return <WarningCircleIcon aria-hidden="true" className="size-4" />;
		case "agent_stream_stopped":
			return <StopCircleIcon aria-hidden="true" className="size-4" />;
		case "sending":
		case "sending_delayed":
			return <ClockClockwiseIcon aria-hidden="true" className="size-4" />;
		case "delivered":
			return null;
		default: {
			const _exhaustive: never = presentation;
			return _exhaustive;
		}
	}
}
