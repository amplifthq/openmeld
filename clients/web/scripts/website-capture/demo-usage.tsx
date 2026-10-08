import { TabItem, TabPanel, Tabs, TabsList } from "@openmeld/ui/fluid/tabs";
import { useState } from "react";
import { LocalAgentTokenUsageCard } from "../../src/components/computers/computer-token-usage";
import { RemoteUsageCard } from "../../src/components/organizations/organization-usage-page";

export function DemoUsage() {
	const [scope, setScope] = useState("organization");
	return (
		<div className="demo-usage">
			<Tabs onValueChange={setScope} value={scope}>
				<div className="demo-usage-heading">
					<h1 className="font-medium text-xl">AI usage</h1>
					<TabsList aria-label="Usage scope">
						<TabItem label="Organization usage" value="organization" />
						<TabItem label="My agents" value="my" />
					</TabsList>
				</div>
				{["organization", "my"].map((value) => (
					<TabPanel className="demo-usage-stack" key={value} value={value}>
						<div className="demo-usage-remote">
							<RemoteUsageCard
								organizationId="org"
								personal={value === "my"}
								showRefresh={false}
								userId="preview"
							/>
						</div>
						<div className="demo-usage-local">
							<LocalAgentTokenUsageCard
								organizationId="org"
								showRefresh={false}
								userId={value === "my" ? "preview" : undefined}
							/>
						</div>
					</TabPanel>
				))}
			</Tabs>
		</div>
	);
}
