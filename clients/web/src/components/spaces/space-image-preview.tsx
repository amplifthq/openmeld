import {
	MorphingDialog,
	MorphingDialogClose,
	MorphingDialogContainer,
	MorphingDialogContent,
	MorphingDialogImage,
	MorphingDialogTitle,
	MorphingDialogTrigger,
} from "@openmeld/ui/components/morphing-dialog";
import { cn } from "@openmeld/ui/lib/utils";
import { XIcon } from "@phosphor-icons/react";
import { useReducedMotionConfig } from "framer-motion";

export function SpaceImagePreview(input: {
	altText: string;
	focusedAction?:
		| { href: string; label: string; onSelect?: never }
		| { href?: never; label: string; onSelect: () => void };
	height?: number;
	imageSource: string;
	isSingle: boolean;
	onError?: () => void;
	thumbnailClassName?: string;
	width?: number;
}) {
	const shouldReduceMotion = useReducedMotionConfig();
	const focusedActionClassName =
		"absolute right-3 bottom-3 border border-border bg-background/95 px-3 py-2 font-medium text-foreground text-xs shadow-sm backdrop-blur-sm transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 motion-reduce:transition-none";

	return (
		<MorphingDialog
			transition={
				shouldReduceMotion === true
					? { duration: 0 }
					: { duration: 0.2, ease: [0.215, 0.61, 0.355, 1] }
			}
		>
			<MorphingDialogTrigger
				aria-label={`Open ${input.altText}`}
				className={cn(
					"group/image relative flex max-w-full items-center justify-center overflow-hidden focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/50",
					input.isSingle ? "w-fit" : "aspect-square w-full",
					input.thumbnailClassName
				)}
			>
				<MorphingDialogImage
					alt={input.altText}
					className={cn(
						"block transition-opacity group-hover/image:opacity-90 motion-reduce:transition-none",
						input.isSingle
							? "h-auto max-h-[32rem] w-auto max-w-full object-contain"
							: "h-full w-full object-cover"
					)}
					decoding="async"
					height={input.height}
					loading="lazy"
					onError={input.onError}
					src={input.imageSource}
					width={input.width}
				/>
			</MorphingDialogTrigger>
			<MorphingDialogContainer>
				<MorphingDialogContent className="relative">
					<MorphingDialogTitle className="sr-only">
						{input.altText}
					</MorphingDialogTitle>
					<MorphingDialogImage
						alt={input.altText}
						className="h-auto max-h-[90vh] w-full max-w-[90vw] object-contain"
						height={input.height}
						src={input.imageSource}
						width={input.width}
					/>
					{input.focusedAction ? (
						<SpaceImageFocusedAction
							action={input.focusedAction}
							className={focusedActionClassName}
						/>
					) : null}
					<MorphingDialogClose className="absolute top-3 right-3 rounded-full bg-white p-1 text-black shadow-sm hover:bg-white/90">
						<XIcon aria-hidden="true" className="size-4" />
					</MorphingDialogClose>
				</MorphingDialogContent>
			</MorphingDialogContainer>
		</MorphingDialog>
	);
}

function SpaceImageFocusedAction(input: {
	action:
		| { href: string; label: string; onSelect?: never }
		| { href?: never; label: string; onSelect: () => void };
	className: string;
}) {
	if (input.action.href) {
		return (
			<a
				className={input.className}
				href={input.action.href}
				rel="noreferrer"
				target="_blank"
			>
				{input.action.label}
			</a>
		);
	}
	return (
		<button
			className={input.className}
			onClick={input.action.onSelect}
			type="button"
		>
			{input.action.label}
		</button>
	);
}
