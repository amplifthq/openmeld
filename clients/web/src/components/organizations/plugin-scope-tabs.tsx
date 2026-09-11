import { TabsSubtle, TabsSubtleItem } from "@openmeld/ui/fluid/tabs-subtle";
import { BuildingsIcon, UserIcon } from "@phosphor-icons/react";
import { getRouteApi, useLocation, useNavigate } from "@tanstack/react-router";

const pluginsRoute = getRouteApi("/o/$orgSlug/plugins");

export function usePluginScope() {
	return pluginsRoute.useSearch().scope;
}

export function PluginScopeTabs(input: {
	organizationName: string;
	isPersonalWorkspace: boolean;
}) {
	const scope = usePluginScope();
	const navigate = useNavigate();
	const pathname = useLocation({ select: (location) => location.pathname });
	if (input.isPersonalWorkspace) {
		return null;
	}
	return (
		<TabsSubtle
			aria-label="Configure plugins for"
			className="w-fit max-w-full gap-6"
			onSelect={(index) =>
				navigate({
					to: pathname,
					search: { scope: index === 0 ? "organization" : "personal" },
					replace: true,
				})
			}
			selectedIndex={scope === "organization" ? 0 : 1}
			variant="underline"
		>
			<TabsSubtleItem
				icon={BuildingsIcon}
				index={0}
				label={input.organizationName}
			/>
			<TabsSubtleItem icon={UserIcon} index={1} label="Personal" />
		</TabsSubtle>
	);
}
