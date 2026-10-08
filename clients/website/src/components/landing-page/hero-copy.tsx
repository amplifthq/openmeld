import {
	homePageCopy,
	homePageLocalAgents,
} from "@openmeld/product-catalog/site";
import {
	BotAvatar,
	type BotAvatarType,
} from "@openmeld/ui/components/bot-avatar";
import { LocalAgentLogo } from "@openmeld/ui/components/local-agent-logo";
import "./hero-copy.css";

const cloudAgents: readonly BotAvatarType[] = [
	"clover",
	"drop",
	"cat",
	"cloud",
	"puddle",
];

export function HeroDescription() {
	return (
		<p className="meld-hero-description meld-hero-copy">
			{homePageCopy.descriptionBeforeCloudAgents}{" "}
			<span className="meld-hero-copy-participant">
				{homePageCopy.cloudAgentsLabel}
				<span aria-hidden="true" className="meld-hero-copy-cloud-agents">
					{cloudAgents.map((agent) => (
						<BotAvatar
							aria-hidden="true"
							className="meld-hero-copy-bot"
							key={agent}
							palette="original"
							size={28}
							type={agent}
						/>
					))}
				</span>
				,
			</span>{" "}
			<span className="meld-hero-copy-participant">
				{homePageCopy.descriptionAfterCloudAgents}
				<span className="sr-only">{`\u00A0(${homePageCopy.agentNames}).`}</span>
				<span aria-hidden="true" className="meld-hero-copy-agent-decoration">
					<span className="meld-hero-copy-agent-marks">
						{homePageLocalAgents.map((agent) => (
							<LocalAgentLogo
								agentId={`builtin:${agent.agentId}`}
								className="meld-hero-copy-agent-mark"
								key={agent.agentId}
								variant="plain"
							/>
						))}
					</span>
				</span>
			</span>
		</p>
	);
}
