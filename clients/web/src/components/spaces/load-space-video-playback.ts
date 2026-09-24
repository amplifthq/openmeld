import videoPlaybackUrl from "virtual:openmeld-video-playback-url";

type PlaybackModule = typeof import("./space-video-playback");

export async function loadSpaceVideoPlayback(): Promise<
	PlaybackModule["SpaceVideoPlayback"]
> {
	if (videoPlaybackUrl === null) {
		throw new Error("Video playback is available only in the client.");
	}
	// The same optional-module boundary as image decoration: a failed player
	// chunk must show Retry, not fire Vite's whole-application reload recovery.
	const module = (await import(
		/* @vite-ignore */ videoPlaybackUrl
	)) as PlaybackModule;
	return module.SpaceVideoPlayback;
}
