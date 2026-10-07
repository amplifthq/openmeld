import { useEffect, useRef, useState } from "react";

/** The same frame remains observed in loading, ready, error, and retry states. */
export function useImageFrameActivity() {
	const frame = useRef<HTMLDivElement>(null);
	const [nearViewport, setNearViewport] = useState(false);
	const [pageVisible, setPageVisible] = useState(true);
	useEffect(() => {
		const updateVisibility = () =>
			setPageVisible(document.visibilityState !== "hidden");
		updateVisibility();
		document.addEventListener("visibilitychange", updateVisibility);
		const element = frame.current;
		let observer: IntersectionObserver | undefined;
		if (element && typeof IntersectionObserver !== "undefined") {
			observer = new IntersectionObserver(
				(entries) => {
					for (const entry of entries) {
						if (entry.target === element) {
							setNearViewport(entry.isIntersecting);
						}
					}
				},
				{ rootMargin: "100px" }
			);
			observer.observe(element);
		} else {
			setNearViewport(true);
		}
		return () => {
			observer?.disconnect();
			document.removeEventListener("visibilitychange", updateVisibility);
		};
	}, []);
	return { frame, active: pageVisible && nearViewport };
}
