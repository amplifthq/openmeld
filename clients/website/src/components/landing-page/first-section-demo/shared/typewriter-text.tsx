import { type ReactNode, useEffect, useState } from "react";

type TypewriterTextProps = {
	charDelayMs?: number;
	className?: string;
	isActive?: boolean;
	renderText?: (visibleText: string) => ReactNode;
	text: string;
};

export function TypewriterText({
	charDelayMs = 14,
	className,
	isActive = true,
	renderText,
	text,
}: TypewriterTextProps) {
	const [visibleLength, setVisibleLength] = useState(() =>
		isActive && text.length > 0 ? 1 : 0
	);

	useEffect(() => {
		if (!isActive) {
			setVisibleLength(0);
			return;
		}

		if (text.length === 0) {
			setVisibleLength(0);
			return;
		}

		if (
			typeof window.matchMedia === "function" &&
			window.matchMedia("(prefers-reduced-motion: reduce)").matches
		) {
			setVisibleLength(text.length);
			return;
		}

		setVisibleLength(1);

		const startedAt = window.performance.now();
		const interval = window.setInterval(() => {
			const elapsedMs = window.performance.now() - startedAt;
			const nextVisibleLength = Math.min(
				text.length,
				Math.max(1, Math.ceil(elapsedMs / charDelayMs))
			);

			setVisibleLength((currentVisibleLength) => {
				if (currentVisibleLength === nextVisibleLength) {
					return currentVisibleLength;
				}

				return nextVisibleLength;
			});

			if (nextVisibleLength >= text.length) {
				window.clearInterval(interval);
			}
		}, 16);

		return () => {
			window.clearInterval(interval);
		};
	}, [charDelayMs, isActive, text]);

	const visibleText = text.slice(0, visibleLength);

	return (
		<span className={className}>
			{renderText ? renderText(visibleText) : visibleText}
		</span>
	);
}
