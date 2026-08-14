import { LegalPolicyPage } from "./legal-policy-page";

const LAST_UPDATED = "August 14, 2026";
const SUPPORT_EMAIL = "felix@amplift.ai";

const summaryItems = [
	{
		label: "Service",
		text: "OpenMeld is experimental software for coordinating people and local AI agents through shared Spaces.",
	},
	{
		label: "Your control",
		text: "You choose the computers, agents, accounts, Apps, repositories, and content that you connect.",
	},
	{
		label: "No warranty",
		text: "The hosted service and open-source software are provided without uptime, outcome, or fitness guarantees.",
	},
	{
		label: "Contact",
		text: `Questions about these terms can be sent to ${SUPPORT_EMAIL}.`,
	},
] as const;

const termsSections = [
	{
		title: "1. Agreement to These Terms",
		paragraphs: [
			"These Terms of Service govern your use of OpenMeld, including the OpenMeld website, hosted service, account features, connected Apps, CLI-supported setup, optional desktop surfaces, and local OpenMeld Service.",
			"By creating an account or using OpenMeld, you agree to these terms. If you use OpenMeld for an organization, you represent that you are authorized to accept these terms for that organization.",
		],
	},
	{
		title: "2. Experimental Service",
		paragraphs: [
			"OpenMeld is an experimental service. Features, data models, limits, integrations, and availability may change, and some features may fail or be discontinued.",
			"Do not rely on OpenMeld as the only control for safety-critical, medical, financial, legal, security-sensitive, or other high-risk work. Review important agent actions and outputs before relying on them.",
		],
	},
	{
		title: "3. Accounts and Security",
		paragraphs: [
			"You must provide accurate account information, keep your authentication methods secure, and promptly tell us if you believe your account has been compromised.",
			"You are responsible for activity performed through your account unless applicable law says otherwise. You may not share access in a way that defeats account, organization, or permission boundaries.",
		],
	},
	{
		title: "4. Connected Computers, Agents, and Apps",
		paragraphs: [
			"You are responsible for every computer, local agent runtime, repository, third-party service, and connected account you authorize OpenMeld to use. You must have permission to use those systems and data.",
			"When you connect a Google account, OpenMeld's current production baseline requests read-only access. OpenMeld may read information from that connected Google account only when needed to provide the features you request and subject to the permissions you approved.",
			"Third-party products have their own terms, privacy practices, limits, and security controls. OpenMeld does not control those products and is not responsible for their independent operation.",
		],
	},
	{
		title: "5. Your Content",
		paragraphs: [
			"You retain ownership of content you submit to OpenMeld. You give Amplift a limited license to host, process, transmit, display, and back up that content only as needed to operate, secure, support, and improve the service.",
			"You are responsible for having the rights and permissions needed to submit content and to share it with the people, agents, Organizations, and third-party services you select.",
		],
	},
	{
		title: "6. Acceptable Use",
		paragraphs: [
			"You may not use OpenMeld to break the law, violate another person's rights, access systems or data without authorization, distribute malware, evade security controls, harass others, or materially disrupt the service.",
			"You may not probe or exploit OpenMeld except through a good-faith, authorized security review. Contact us before testing production systems in a way that could affect other users.",
		],
	},
	{
		title: "7. Open-Source Software",
		paragraphs: [
			"OpenMeld source code is available under the MIT License. The MIT License governs your use of that source code. These Terms govern the hosted service, user accounts, operational systems, and services provided by Amplift.",
			"Public repository activity is public. Do not post credentials, private data, confidential content, or production diagnostics in public issues, discussions, or pull requests.",
		],
	},
	{
		title: "8. Suspension and Termination",
		paragraphs: [
			"You may stop using OpenMeld at any time. We may suspend or terminate access when reasonably necessary to protect users or the service, investigate abuse, comply with law, or address a material violation of these terms.",
			"Where practical, we will provide notice and a reasonable opportunity to correct a problem before termination. Some obligations, including ownership, disclaimers, liability limits, and dispute terms, survive termination.",
		],
	},
	{
		title: "9. Service Availability and Changes",
		paragraphs: [
			"We do not promise uninterrupted availability, data retention, feature permanence, or a service-level agreement unless we agree to one separately in writing.",
			"We may change these terms as OpenMeld evolves. If a change is material, we will provide reasonable notice through the product, website, email, repository, or another appropriate channel.",
		],
	},
	{
		title: "10. Disclaimers",
		paragraphs: [
			"To the fullest extent permitted by law, OpenMeld is provided “as is” and “as available.” Amplift disclaims implied warranties, including merchantability, fitness for a particular purpose, title, and non-infringement.",
			"AI agents and third-party services can produce incomplete, incorrect, unsafe, or unexpected results. You are responsible for reviewing outputs and deciding whether an action or result is appropriate.",
		],
	},
	{
		title: "11. Limitation of Liability",
		paragraphs: [
			"To the fullest extent permitted by law, Amplift will not be liable for indirect, incidental, special, consequential, exemplary, or punitive damages, or for lost profits, data, goodwill, or business opportunities arising from OpenMeld.",
			"Nothing in these terms limits liability that cannot legally be limited. Any additional liability terms for a paid or enterprise service must be agreed separately in writing.",
		],
	},
	{
		title: "12. Governing Terms",
		paragraphs: [
			"These terms, the Privacy Policy, and any written service-specific agreement between you and Amplift form the agreement governing OpenMeld. If a separate signed agreement conflicts with these terms, the signed agreement controls for that conflict.",
			"If part of these terms is unenforceable, the remaining terms continue to apply. A delay in enforcing a term is not a waiver of that term.",
		],
	},
	{
		title: "13. Contact",
		paragraphs: [
			`Questions or notices about these terms may be sent to Amplift at ${SUPPORT_EMAIL}.`,
		],
	},
] as const;

export function TermsOfServicePage() {
	return (
		<LegalPolicyPage
			intro="These terms explain the rules for using OpenMeld, an experimental service that connects shared cloud work with local AI agents and optional third-party Apps."
			lastUpdated={LAST_UPDATED}
			sections={termsSections}
			summaryItems={summaryItems}
			title="Terms of Service"
		/>
	);
}
