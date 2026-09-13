import { TabsSubtle, TabsSubtleItem } from "@openmeld/ui/fluid/tabs-subtle";
import { useNavigate } from "@tanstack/react-router";
import { useAppOrganization } from "#/lib/organizations/organization-context";

const views = [undefined, "messages", "discover"] as const;
export function SpacesDirectoryNavigation({
	view,
	onSpaceViewChange,
}: {
	view?: "discover" | "messages";
	onSpaceViewChange?: (view: "discover" | undefined) => void;
}) {
	const navigate = useNavigate();
	const { currentOrganization } = useAppOrganization();
	return (
		<TabsSubtle
			aria-label="Spaces view"
			className="h-full shrink-0 gap-5"
			idPrefix="spaces-directory"
			onSelect={(index) => {
				const next = views[index];
				if (next !== "messages" && onSpaceViewChange) {
					onSpaceViewChange(next);
					return;
				}
				navigate({
					to: "/o/$orgSlug/spaces",
					params: { orgSlug: currentOrganization.slug },
					search: {
						view: next,
					},
				}).catch(console.error);
			}}
			selectedIndex={views.indexOf(view)}
			variant="underline"
		>
			<TabsSubtleItem index={0} label="Your Spaces" labelClassName="text-sm" />
			<TabsSubtleItem
				index={1}
				label="Direct messages"
				labelClassName="text-sm"
			/>
			{!currentOrganization.isPersonal && (
				<TabsSubtleItem index={2} label="Discover" labelClassName="text-sm" />
			)}
		</TabsSubtle>
	);
}
