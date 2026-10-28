import { TabsSubtle, TabsSubtleItem } from "@openmeld/ui/fluid/tabs-subtle";
import { useQueryState } from "nuqs";
import { useAppOrganization } from "#/lib/organizations/organization-context";
import { spacesViewParser } from "#/lib/page-tab-search";

const views = ["conversations", "spaces", "messages", "discover"] as const;
export function SpacesDirectoryNavigation() {
	const [view, setView] = useQueryState("view", spacesViewParser);
	const { currentOrganization } = useAppOrganization();
	const visibleView =
		view === "discover" && currentOrganization.isPersonal ? "spaces" : view;
	return (
		<TabsSubtle
			aria-label="Spaces view"
			className="h-full shrink-0 gap-5"
			idPrefix="spaces-directory"
			onSelect={(index) => {
				setView(views[index] ?? "conversations");
			}}
			selectedIndex={views.indexOf(visibleView)}
			variant="underline"
		>
			<TabsSubtleItem index={0} label="Chats" labelClassName="text-sm" />
			<TabsSubtleItem index={1} label="Your Spaces" labelClassName="text-sm" />
			<TabsSubtleItem
				index={2}
				label="Direct messages"
				labelClassName="text-sm"
			/>
			{!currentOrganization.isPersonal && (
				<TabsSubtleItem index={3} label="Discover" labelClassName="text-sm" />
			)}
		</TabsSubtle>
	);
}
