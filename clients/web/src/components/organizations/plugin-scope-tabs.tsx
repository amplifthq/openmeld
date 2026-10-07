import { TabItem, Tabs, TabsList } from "@openmeld/ui/fluid/tabs";
import { BuildingsIcon, UserIcon } from "@phosphor-icons/react";
import { useQueryState } from "nuqs";
import { pluginScopeParser } from "#/lib/page-tab-search";

export function usePluginScope() {
	return useQueryState("scope", pluginScopeParser)[0];
}

export function PluginScopeTabs(input: {
	organizationName: string;
	isPersonalWorkspace: boolean;
}) {
	const [scope, setScope] = useQueryState("scope", pluginScopeParser);
	if (input.isPersonalWorkspace) {
		return null;
	}
	return (
		<Tabs
			onValueChange={(value) =>
				setScope(value === "personal" ? "personal" : "organization")
			}
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
