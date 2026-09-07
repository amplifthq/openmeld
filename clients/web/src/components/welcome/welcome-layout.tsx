import type { ReactNode } from "react";

export type WelcomeLayoutProps = {
	presentation?: "page" | "dialog";
	title: string;
	subtitle?: string;
	/** Optional small "back" affordance above the title; navigation is the
	 * caller's (controller's) concern, so the layout stays router-free. */
	onBack?: () => void;
	children: ReactNode;
};

/**
 * Shared first-run layout for focused app onboarding screens. A centered,
 * fixed-width column keeps one form or one choice set from sprawling across the
 * full content area. Navigation stays the caller's concern, so the layout is
 * router-free.
 */
export function WelcomeLayout(props: WelcomeLayoutProps) {
	return (
		<section
			className={
				props.presentation === "dialog"
					? "flex flex-col"
					: "flex min-h-[calc(100svh-10rem)] flex-col items-center max-lg:px-4 max-lg:pb-4"
			}
		>
			<div
				className={
					props.presentation === "dialog"
						? "flex w-full flex-col gap-6"
						: "flex w-full max-w-md flex-1 flex-col justify-center gap-10"
				}
			>
				<header className="flex min-w-0 flex-col gap-3">
					{props.onBack ? (
						<button
							className="w-fit text-muted-foreground text-sm transition-colors hover:text-foreground"
							onClick={props.onBack}
							type="button"
						>
							back
						</button>
					) : null}
					<h1 className="font-medium text-foreground text-lg sm:text-xl">
						{props.title}
					</h1>
					{props.subtitle ? (
						<p className="text-muted-foreground text-sm">{props.subtitle}</p>
					) : null}
				</header>
				<div className="w-full">{props.children}</div>
			</div>
		</section>
	);
}
