import { useEffect, useRef, useState } from "react";

export function useHomeWindowVisibility() {
	const ref = useRef<HTMLElement | null>(null);
	const [visible, setVisible] = useState(false);
	useEffect(() => {
		const element = ref.current;
		if (!element) {
			return;
		}
		const observer = new IntersectionObserver(
			([entry]) => setVisible(entry.isIntersecting),
			{
				root: element.closest("[data-home-canvas]"),
				rootMargin: "120px",
			}
		);
		observer.observe(element);
		return () => observer.disconnect();
	}, []);
	return { ref, visible };
}
