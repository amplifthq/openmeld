import { cn } from "@openmeld/ui/lib/utils";
import type { ReactNode, RefObject } from "react";

type DemoWorkspaceLayoutProps = {
	openMeldPane: ReactNode;
	openMeldPaneRef?: RefObject<HTMLDivElement | null>;
	isProviderLayoutVisible: boolean;
	providerPane: ReactNode;
	rootScrollRef?: RefObject<HTMLDivElement | null>;
};

export function DemoWorkspaceLayout({
	openMeldPane,
	openMeldPaneRef,
	isProviderLayoutVisible,
	providerPane,
	rootScrollRef,
}: DemoWorkspaceLayoutProps) {
	return (
		<div
			className="h-full overflow-y-auto lg:overflow-hidden"
			ref={rootScrollRef}
		>
			<div
				className="flex min-h-full flex-col lg:grid lg:h-full"
				style={{
					gridTemplateColumns: isProviderLayoutVisible
						? "minmax(0,0.59fr) minmax(0,0.41fr)"
						: "minmax(0,1fr) minmax(0,0fr)",
					transition:
						"grid-template-columns 700ms cubic-bezier(0.16, 1, 0.3, 1)",
				}}
			>
				<div className="min-h-0 lg:overflow-y-auto" ref={openMeldPaneRef}>
					{openMeldPane}
				</div>

				<div
					aria-hidden={!isProviderLayoutVisible}
					className={cn(
						"min-h-0 overflow-hidden border-border/70 border-t lg:border-t-0 lg:border-l lg:transition-opacity lg:duration-500 lg:ease-out",
						!isProviderLayoutVisible && "hidden lg:block lg:opacity-0",
						isProviderLayoutVisible && "lg:opacity-100"
					)}
					data-testid="provider-pane-region"
					data-visible={isProviderLayoutVisible ? "true" : "false"}
				>
					{providerPane}
				</div>
			</div>
		</div>
	);
}
