import { TabItem, Tabs, TabsList } from "@openmeld/ui/fluid/tabs";
import { BuildingsIcon, UserIcon } from "@phosphor-icons/react";
import { getRouteApi, useLocation } from "@tanstack/react-router";

const pluginsRoute = getRouteApi("/o/$orgSlug/plugins");

export function usePluginScope() {
	return pluginsRoute.useSearch({ select: (search) => search.scope });
}

export function PluginScopeTabs(input: {
	organizationName: string;
	isPersonalWorkspace: boolean;
}) {
	const scope = usePluginScope();
	const navigate = pluginsRoute.useNavigate();
	const pathname = useLocation({ select: (location) => location.pathname });
	if (input.isPersonalWorkspace) {
		return null;
	}
	return (
		<Tabs
			onValueChange={(value) => {
				navigate({
					to: pathname,
					resetScroll: false,
					search: (previous) => ({
						...previous,
						scope: value === "personal" ? "personal" : "organization",
					}),
				});
			}}
			value={scope}
		>
			<TabsList aria-label="Configure plugins for" className="w-fit max-w-full">
				<TabItem
					icon={BuildingsIcon}
					label={input.organizationName}
					value="organization"
				/>
				<TabItem icon={UserIcon} label="Personal" value="personal" />
			</TabsList>
		</Tabs>
	);
}
