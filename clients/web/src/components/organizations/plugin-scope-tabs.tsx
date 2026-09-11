import { TabsSubtle, TabsSubtleItem } from "@openmeld/ui/fluid/tabs-subtle";
import { BuildingsIcon, UserIcon } from "@phosphor-icons/react";
import { getRouteApi } from "@tanstack/react-router";

const pluginsRoute = getRouteApi("/o/$orgSlug/plugins");

export function usePluginScope() {
	return pluginsRoute.useSearch().scope;
}

export function PluginScopeTabs(input: {
	organizationName: string;
	isPersonalWorkspace: boolean;
}) {
	const scope = usePluginScope();
	const navigate = pluginsRoute.useNavigate();
	if (input.isPersonalWorkspace) {
		return null;
	}
	return (
		<TabsSubtle
			aria-label="Configure plugins for"
			className="w-fit max-w-full"
			onSelect={(index) =>
				navigate({
					search: { scope: index === 0 ? "personal" : "organization" },
					replace: true,
				})
			}
			selectedIndex={scope === "organization" ? 1 : 0}
			variant="underline"
		>
			<TabsSubtleItem icon={UserIcon} index={0} label="Personal" />
			<TabsSubtleItem
				icon={BuildingsIcon}
				index={1}
				label={input.organizationName}
			/>
		</TabsSubtle>
	);
}
