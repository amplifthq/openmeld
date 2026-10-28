import { TabsSubtle, TabsSubtleItem } from "@openmeld/ui/fluid/tabs-subtle";
import { cn } from "@openmeld/ui/lib/utils";
import {
	getSpaceViewIndex,
	resolveSpaceView,
	type SpaceView,
} from "./space-view";

export function SpaceViewTabs(input: {
	activeView: SpaceView;
	className?: string;
	guideEnabled?: boolean;
	idPrefix: string;
	onViewChange: (view: SpaceView) => void;
	tasksEnabled?: boolean;
}) {
	return (
		<TabsSubtle
			aria-label="Space view"
			className={cn("h-full gap-5", input.className)}
			idPrefix={input.idPrefix}
			onSelect={(index) => {
				input.onViewChange(resolveSpaceView(index));
			}}
			selectedIndex={getSpaceViewIndex(input.activeView)}
			variant="underline"
		>
			<TabsSubtleItem index={0} label="Messages" labelClassName="text-sm" />
			{input.tasksEnabled !== false ? (
				<TabsSubtleItem index={3} label="Tasks" labelClassName="text-sm" />
			) : null}
			{/* Graph navigation is hidden until a board replaces this view.
			<TabsSubtleItem index={1} label="Graph" labelClassName="text-sm" />
			*/}
			<TabsSubtleItem index={2} label="Files" labelClassName="text-sm" />
			{input.guideEnabled ? (
				<TabsSubtleItem index={4} label="Guide" labelClassName="text-sm" />
			) : null}
		</TabsSubtle>
	);
}
