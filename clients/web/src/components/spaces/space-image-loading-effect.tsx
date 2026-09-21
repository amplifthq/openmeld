import { ImageGeneration } from "img-fx";
import { Component, type ReactNode, useSyncExternalStore } from "react";

// This module is lazy-loaded only for an active cold image. This is capability
// state, not a second image cache. No private source URL reaches img-fx.
let graphicsFailed = false;
const listeners = new Set<() => void>();
const noImages: string[] = [];
const serverSnapshot = () => false;
const snapshot = () =>
	!graphicsFailed && typeof WebGL2RenderingContext !== "undefined";
function disableGraphics() {
	graphicsFailed = true;
	for (const listener of listeners) {
		listener();
	}
}
function subscribe(listener: () => void) {
	if (listeners.size === 0) {
		window.addEventListener("img-fx:context-lost", disableGraphics);
	}
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
		if (listeners.size === 0) {
			window.removeEventListener("img-fx:context-lost", disableGraphics);
		}
	};
}

class RendererBoundary extends Component<
	{ children: ReactNode },
	{ failed: boolean }
> {
	state = { failed: false };
	static getDerivedStateFromError() {
		return { failed: true };
	}
	componentDidCatch() {
		// One failed renderer should not trigger more GPU allocations elsewhere.
		disableGraphics();
		console.warn(
			"Image loading effect unavailable; using the static placeholder."
		);
	}
	render() {
		return this.state.failed ? null : this.props.children;
	}
}

export default function SpaceImageLoadingEffect() {
	const supported = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
	if (!supported) {
		return null;
	}
	return (
		<RendererBoundary>
			<ImageGeneration
				aria-hidden="true"
				autoReveal={false}
				className="absolute inset-0 size-full"
				images={noImages}
				paused={false}
				preset="pixels-organic"
				strength={0.35}
				style={{ width: "100%", height: "100%" }}
			>
				<div className="size-full" />
			</ImageGeneration>
		</RendererBoundary>
	);
}
