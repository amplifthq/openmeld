import type { ReactNode } from "react";
import { AppContextualContentFrame } from "#/components/app/app-contextual-layout";
import { APP_CONTEXTUAL_MAIN_TEXT_BASE_START_CLASS_NAME } from "#/components/app/app-contextual-layout-style";
import {
	type CenterAgentRouteState,
	CenterAgentRouteStateProvider,
} from "./center-agent-route-state";

export function CenterAgentSectionFrame(input: {
	children: ReactNode;
	routeState?: Partial<CenterAgentRouteState>;
}) {
	return (
		<AppContextualContentFrame
			bodySlotName="center-agent-section-scroll"
			contentClassName="pt-3"
			headerSlotName="center-agent-section-header"
		>
			<CenterAgentRouteStateProvider value={input.routeState}>
				<div
					className={`flex flex-col gap-4 ${APP_CONTEXTUAL_MAIN_TEXT_BASE_START_CLASS_NAME}`}
				>
					{input.children}
				</div>
			</CenterAgentRouteStateProvider>
		</AppContextualContentFrame>
	);
}
