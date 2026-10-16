import type { ReactNode, Ref } from "react";
import { AppModuleSidebarToggle } from "./app-module-sidebar";

/** Shared heading and controls for the Spaces and Team module sidebars. */
export function AppModuleSidebarHeader(input: {
	children?: ReactNode;
	ref?: Ref<HTMLDivElement>;
	title: ReactNode;
	titleRef?: Ref<HTMLDivElement>;
}) {
	return (
		<div className="mb-2 px-1">
			<div
				className="relative flex min-h-7 min-w-0 items-center gap-1"
				data-slot="app-module-sidebar-header"
				ref={input.ref}
			>
				<div className="flex shrink-0 items-center gap-1" ref={input.titleRef}>
					<AppModuleSidebarToggle placement="sidebar" />
					{typeof input.title === "string" ? (
						<h2 className="font-medium text-sm">{input.title}</h2>
					) : (
						input.title
					)}
				</div>
				{input.children}
			</div>
		</div>
	);
}
