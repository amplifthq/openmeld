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
	idPrefix: string;
	onViewChange: (view: SpaceView) => void;
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
			<TabsSubtleItem index={1} label="Graph" labelClassName="text-sm" />
		</TabsSubtle>
	);
}
