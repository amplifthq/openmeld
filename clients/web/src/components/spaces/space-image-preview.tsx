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
import {
	lazy,
	type Ref,
	Suspense,
	useCallback,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import { loadSpaceImageEffect } from "./load-space-image-effect";
import { SPACE_ATTACHMENT_FRAME_CLASS } from "./space-attachment-strip";
import { resolveSpaceImageFrame } from "./space-image-frame";
import { useSpaceImagePreviewSource } from "./use-space-image-preview-source";

const LoadingEffect = lazy(loadSpaceImageEffect);

function useImageReadiness(source: string | null) {
	const image = useRef<HTMLImageElement>(null);
	const [attempt, setAttempt] = useState(0);
	const identity = `${source ?? "missing"}:${attempt}`;
	const latestIdentity = useRef(identity);
	latestIdentity.current = identity;
	const [result, setResult] = useState<{
		identity: string;
		status: "ready" | "failed";
	} | null>(null);
	const reportError = useCallback(() => {
		if (latestIdentity.current === identity) {
			setResult({ identity, status: "failed" });
		}
	}, [identity]);
	const reportLoaded = useCallback(
		(element: HTMLImageElement) => {
			const markReady = () => {
				if (latestIdentity.current === identity) {
					setResult({ identity, status: "ready" });
				}
			};
			if (typeof element.decode === "function") {
				element.decode().then(markReady, reportError);
			} else {
				markReady();
			}
		},
		[identity, reportError]
	);
	useLayoutEffect(() => {
		latestIdentity.current = identity;
		const element = image.current;
		if (element?.complete && element.naturalWidth > 0) {
			reportLoaded(element);
		}
		return () => {
			latestIdentity.current = "unmounted";
		};
	}, [identity, reportLoaded]);
	return {
		image,
		attempt,
		failed: result?.identity === identity && result.status === "failed",
		ready: result?.identity === identity && result.status === "ready",
		reportError,
		reportLoaded,
		retry: () => setAttempt((value) => value + 1),
	};
}

function resolvePreviewFrame(
	attachment: boolean | undefined,
	single: boolean,
	geometry: ReturnType<typeof resolveSpaceImageFrame>
) {
	if (attachment) {
		return {
			className: SPACE_ATTACHMENT_FRAME_CLASS,
			style: undefined,
			fit: "object-cover",
		};
	}
	return {
		className: single ? undefined : "aspect-square w-full",
		style: single ? geometry : undefined,
		fit: "object-contain",
	};
}

export function SpaceImagePreview(input: {
	altText: string;
	focusedAction?:
		| { href: string; label: string; onSelect?: never }
		| { href?: never; label: string; onSelect: () => void };
	height?: number;
	imageSource: string | null;
	isSingle: boolean;
	active?: boolean;
	cold?: boolean;
	error?: boolean;
	frameRef?: Ref<HTMLDivElement>;
	onError?: () => void;
	onRetry?: () => void | Promise<void>;
	thumbnailClassName?: string;
	/** Compact attachment crop only; the focused viewer always shows the original. */
	attachmentThumbnail?: boolean;
	width?: number;
}) {
	const shouldReduceMotion = useReducedMotionConfig();
	const source = useSpaceImagePreviewSource(input.imageSource);
	const [geometry] = useState(() =>
		resolveSpaceImageFrame(input.width, input.height)
	);
	const frame = resolvePreviewFrame(
		input.attachmentThumbnail,
		input.isSingle,
		geometry
	);
	const beganCold = useRef(!input.imageSource || input.cold === true);
	if (!input.imageSource) {
		beganCold.current = true;
	}
	const readiness = useImageReadiness(source.source);
	const failed = input.error === true || readiness.failed || source.revoked;
	const displaySource = failed ? null : source.source;
	const loading =
		!failed &&
		(!input.imageSource ||
			((beganCold.current || readiness.attempt > 0) && !readiness.ready));
	const reportError = () => {
		readiness.reportError();
		input.onError?.();
	};
	const retry = () => {
		readiness.retry();
		Promise.resolve(input.onRetry?.()).catch(() => {
			readiness.reportError();
		});
	};

	const focusedActionClassName =
		"absolute right-3 bottom-3 border border-border bg-background/95 px-3 py-2 font-medium text-foreground text-xs shadow-sm backdrop-blur-sm transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 motion-reduce:transition-none";

	return (
		<div
			className={cn(
				"relative min-w-0 overflow-hidden rounded-lg bg-muted",
				frame.className,
				input.thumbnailClassName
			)}
			data-image-frame=""
			ref={input.frameRef}
			style={frame.style}
		>
			<MorphingDialog
				transition={
					shouldReduceMotion === true
						? { duration: 0 }
						: { duration: 0.2, ease: [0.215, 0.61, 0.355, 1] }
				}
			>
				<MorphingDialogTrigger
					aria-label={`Open ${input.altText}`}
					className="group/image absolute inset-0 flex size-full items-center justify-center overflow-hidden focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/50"
					disabled={!displaySource}
				>
					{displaySource ? (
						<MorphingDialogImage
							alt={input.altText}
							className={cn(
								"block size-full transition-opacity group-hover/image:opacity-90 motion-reduce:transition-none",
								frame.fit
							)}
							decoding="async"
							height={input.height}
							key={readiness.attempt}
							loading="lazy"
							onError={reportError}
							onLoad={(event) => readiness.reportLoaded(event.currentTarget)}
							ref={readiness.image}
							src={displaySource}
							width={input.width}
						/>
					) : null}
				</MorphingDialogTrigger>
				<MorphingDialogContainer>
					<MorphingDialogContent className="relative">
						<MorphingDialogTitle className="sr-only">
							{input.altText}
						</MorphingDialogTitle>
						{displaySource ? (
							<MorphingDialogImage
								alt={input.altText}
								className="h-auto max-h-[90vh] w-auto max-w-[90vw] object-contain"
								height={input.height}
								onError={reportError}
								src={displaySource}
								width={input.width}
							/>
						) : (
							<div className="flex min-h-48 min-w-64 items-center justify-center bg-background p-8 text-muted-foreground">
								Image unavailable
							</div>
						)}
						{input.focusedAction && displaySource ? (
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
			{loading ? (
				<output
					aria-label={`Loading ${input.altText}`}
					className="pointer-events-none absolute inset-0 size-full bg-muted"
				>
					<span className="sr-only">Loading image</span>
					{input.active && shouldReduceMotion !== true ? (
						<Suspense fallback={null}>
							<LoadingEffect />
						</Suspense>
					) : null}
				</output>
			) : null}
			{failed ? (
				<div className="absolute inset-0 flex size-full flex-col items-center justify-center gap-0.5 bg-muted p-1 text-center text-muted-foreground text-xs leading-tight">
					<span>Image unavailable</span>
					<button
						className="rounded px-2 py-1 underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
						onClick={retry}
						type="button"
					>
						Retry image
					</button>
				</div>
			) : null}
		</div>
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
