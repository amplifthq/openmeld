import {
	MorphingDialog,
	MorphingDialogClose,
	MorphingDialogContainer,
	MorphingDialogContent,
	MorphingDialogFrame,
	MorphingDialogTitle,
	MorphingDialogTrigger,
} from "@openmeld/ui/components/morphing-dialog";
import { cn } from "@openmeld/ui/lib/utils";
import { ArrowsOutIcon, PlayIcon, XIcon } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { loadSpaceVideoPlayback } from "./load-space-video-playback";
import type {
	SpaceVideoPlaybackProps,
	VideoPlaybackSnapshot,
} from "./space-video-playback";

type Playback = typeof import("./space-video-playback").SpaceVideoPlayback;
let playbackModule: Promise<Playback> | undefined;
function loadPlayback(): Promise<Playback> {
	playbackModule ??= loadSpaceVideoPlayback().catch((error: unknown) => {
		playbackModule = undefined;
		throw error;
	});
	return playbackModule;
}

export type SpaceVideoTarget = {
	spaceId: string;
	fileId: string;
	revision: number;
	organizationSlug?: string;
};

/** Idle instances render only a card: no player import, media element, request or observer. */
export function SpaceVideoPreview(input: {
	fileName: string;
	target?: SpaceVideoTarget;
	localPreviewUrl?: string | null;
	isLocal?: boolean;
	compact?: boolean;
	onOpenFile?: () => void;
}) {
	const [open, setOpen] = useState(false);
	const [activation, setActivation] = useState(0);
	const active = activation > 0;
	const [PlaybackComponent, setPlaybackComponent] = useState<Playback | null>(
		null
	);
	const [error, setError] = useState<string | null>(null);
	const videoRef = useRef<HTMLVideoElement | null>(null);
	const transferring = useRef(false);
	const snapshot = useRef<VideoPlaybackSnapshot>({
		time: 0,
		rate: 1,
		volume: 1,
		muted: false,
		playing: true,
	});

	useEffect(() => {
		if (activation === 0) {
			return;
		}
		let cancelled = false;
		loadPlayback()
			.then((component) => {
				if (!cancelled) {
					setPlaybackComponent(() => component);
				}
			})
			.catch(() => {
				if (!cancelled) {
					setError("The video player couldn't load. Try again.");
				}
			});
		return () => {
			cancelled = true;
		};
	}, [activation]);

	const remember = () => {
		const video = videoRef.current;
		if (!video) {
			return;
		}
		snapshot.current = {
			time: video.currentTime,
			rate: video.playbackRate,
			volume: video.volume,
			muted: video.muted,
			playing: !(video.paused || video.ended),
		};
	};
	const activate = () => {
		setError(null);
		snapshot.current.playing = true;
		setActivation((value) => value + 1);
	};
	const changeOpen = (next: boolean) => {
		remember();
		if (next) {
			transferring.current = active;
			if (!active) {
				activate();
			}
		} else {
			transferring.current = false;
			videoRef.current?.pause();
			snapshot.current.playing = false;
			setActivation(0);
		}
		setOpen(next);
	};
	const playbackProps: SpaceVideoPlaybackProps = {
		fileName: input.fileName,
		target: input.target,
		localPreviewUrl: input.localPreviewUrl,
		isLocal: input.isLocal,
		snapshot,
		videoRef,
		transferring,
		onRevoked: () => {
			setActivation(0);
			setOpen(false);
			setError("This video is no longer accessible.");
		},
	};
	const loading = (
		<div
			aria-live="polite"
			className="flex aspect-video items-center justify-center bg-muted text-muted-foreground text-sm"
		>
			Loading video…
		</div>
	);
	const placeholder = (
		<div
			className={cn(
				"flex aspect-video w-full flex-col items-center justify-center gap-3 bg-muted text-muted-foreground",
				input.compact && "aspect-auto size-16"
			)}
		>
			{input.compact ? (
				<MorphingDialogTrigger
					aria-label={`Play ${input.fileName}`}
					className="flex size-12 items-center justify-center rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
					disableLayoutAnimation
				>
					<PlayIcon aria-hidden="true" className="size-6" weight="fill" />
				</MorphingDialogTrigger>
			) : (
				<>
					<button
						aria-label={`Play ${input.fileName}`}
						className="flex size-12 items-center justify-center rounded-full bg-background text-foreground shadow-sm hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
						onClick={activate}
						type="button"
					>
						<PlayIcon aria-hidden="true" className="size-5" weight="fill" />
					</button>
					<span className="max-w-full truncate px-6 text-xs">
						{input.fileName}
					</span>
				</>
			)}
		</div>
	);

	const playback = PlaybackComponent ? (
		<PlaybackComponent {...playbackProps} />
	) : (
		loading
	);
	return (
		<MorphingDialog
			onOpenChange={changeOpen}
			open={open}
			transition={{ duration: 0.2 }}
		>
			<MorphingDialogFrame
				className={cn(
					"relative w-full overflow-hidden rounded-md border border-border bg-background",
					input.compact ? "size-16" : "max-w-2xl"
				)}
			>
				{active && !open && !error ? playback : placeholder}
				{!input.compact && (
					<MorphingDialogTrigger
						aria-label={`Expand ${input.fileName}`}
						className="absolute top-2 right-2 flex size-9 items-center justify-center rounded-md bg-background text-foreground shadow-sm hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
						disableLayoutAnimation
					>
						<ArrowsOutIcon aria-hidden="true" className="size-4" />
					</MorphingDialogTrigger>
				)}
			</MorphingDialogFrame>
			{error && (
				<p className="mt-2 text-destructive text-xs" role="alert">
					{error}
				</p>
			)}
			<MorphingDialogContainer backdropClassName="bg-black/70 backdrop-blur-none">
				<MorphingDialogContent className="w-[min(64rem,calc(100vw-2rem))] overflow-hidden rounded-lg border border-border bg-background shadow-xl">
					<div className="flex items-center gap-3 border-border border-b px-4 py-3">
						<MorphingDialogTitle className="min-w-0 flex-1 truncate font-medium text-sm">
							{input.fileName}
						</MorphingDialogTitle>
						{input.onOpenFile && (
							<button
								className="text-muted-foreground text-xs hover:text-foreground"
								onClick={() => {
									changeOpen(false);
									input.onOpenFile?.();
								}}
								type="button"
							>
								Open in Files
							</button>
						)}
						<MorphingDialogClose
							aria-label="Close video"
							className="static flex size-8 shrink-0 items-center justify-center rounded-md hover:bg-accent"
						>
							<XIcon aria-hidden="true" className="size-4" />
						</MorphingDialogClose>
					</div>
					{active && open && !error ? playback : placeholder}
					{error && (
						<p className="p-4 text-destructive text-sm" role="alert">
							{error}
						</p>
					)}
				</MorphingDialogContent>
			</MorphingDialogContainer>
		</MorphingDialog>
	);
}
