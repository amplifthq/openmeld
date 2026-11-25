import type { ReactNode } from "react";
import { AppModuleSidebarToggle } from "./app-module-sidebar";

/** Shared heading and controls for module sidebars. */
export function AppModuleSidebarHeader(input: {
	children?: ReactNode;
	title: ReactNode;
}) {
	return (
		<div className="mb-2 px-1">
			<div
				className="relative flex min-h-7 min-w-0 items-center gap-1"
				data-slot="app-module-sidebar-header"
			>
				<div className="flex shrink-0 items-center gap-1">
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
