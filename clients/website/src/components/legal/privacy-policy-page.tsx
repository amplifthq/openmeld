import {
	LEGAL_CONTACT_EMAIL,
	LEGAL_ENTITY_NAME,
	LEGAL_LAST_UPDATED,
	LEGAL_POSTAL_ADDRESS,
} from "./legal-policy-details";
import { LegalPolicyPage } from "./legal-policy-page";

const summaryItems = [
	{
		label: "Information we handle",
		text: "Account details, workspace content, connected-service data, and the information needed to run your agents and support the service.",
	},
	{
		label: "AI and collaboration",
		text: "Authorized people, agents, and providers can process content needed for your work. Local execution can also send data to cloud services.",
	},
	{
		label: "Your choices",
		text: "Manage sharing, connected Apps, Project connections, and Center Agent memory. Account deletion and other privacy controls have separate effects.",
	},
	{
		label: "Contact",
		text: `Send privacy questions and rights requests to ${LEGAL_CONTACT_EMAIL}.`,
	},
] as const;

const policySections = [
	{
		title: "1. Who We Are and What This Policy Covers",
		paragraphs: [
			`${LEGAL_ENTITY_NAME} ("Amplift," "we," "us," or "our") operates OpenMeld. Our mailing address is ${LEGAL_POSTAL_ADDRESS}.`,
			"This policy covers the OpenMeld website, Web App, Desktop app, CLI, hosted agents, and local OpenMeld Service. It explains how we handle personal information when you use these services or contact us.",
			"Organizations determine what their members share and which agents, Apps, and Channels they authorize. When we process workspace content on an organization's behalf, that organization may be responsible for its own privacy notices and instructions. Contact your organization about its use of your information. You can also contact us about OpenMeld's practices.",
			"Third-party model providers, agent tools, and connected services have their own privacy policies. This policy does not govern their independent practices or a separate OpenMeld deployment operated by someone else.",
		],
	},
	{
		title: "2. Information We Collect",
		paragraphs: [
			"Account information includes your name, email address, profile image, authentication records, preferences, memberships, invitations, and security events. A sign-in provider may supply account identifiers and profile information when you use it to sign in.",
			"Workspace content includes messages, replies, attachments, Files and revisions, Agent Profile instructions, Projects, Tasks, Routines, Skills, Team Knowledge, and collaboration records. It includes information you or an authorized agent import, generate, save, or publish.",
			"Connected-computer information includes device identifiers and names, operating-system family, software versions, supported agent tools, connection status, setup results, and execution diagnostics. We use these facts to connect the correct computer and explain problems.",
			"Connected-service information includes account identifiers, permission grants, connection records, and authorized content such as email, calendar entries, documents, repository information, issues, or messages. Credentials needed for an App connection are handled by the connection service.",
			"Technical information includes IP addresses, browser and device information, request metadata, timestamps, cookies, feature usage, errors, security signals, and operational logs. Support information includes communications, feedback, and diagnostic reports you submit.",
		],
	},
	{
		title: "3. Local Agents, Hosted Agents, and Cloud Computers",
		paragraphs: [
			"A Wake asks an Agent Profile to do work. A Local Agent runs through a computer you connect. The OpenMeld Service receives authorized work and reports progress, replies, or failures. Your agent may access repositories, files, commands, and terminal output under its permissions.",
			"Local execution does not mean all information stays on your computer. Your agent may send prompts and local context to its model provider. Content can reach OpenMeld through replies, attachments, authorized file operations, context requests, or diagnostics.",
			"Hosted Remote Agents and the Center Agent run through our cloud services. They process authorized conversation context, instructions, memory, Files, Skills, and tool results. Relevant content is sent to the selected model's providers and services that support the execution.",
			"Cloud Computers can retain working files, downloaded copies, command output, and execution records. A Computer's working copy has a separate lifecycle from the original file or service record. Deleting the original does not automatically remove every copy.",
			"We use content to provide the AI features you request. We do not train our own general-purpose AI models on your workspace content. External providers' retention, security review, and model-training practices depend on their terms and the applicable configuration. We do not promise that every provider has the same practices.",
		],
	},
	{
		title: "4. Agent Activity and Local Session Information",
		paragraphs: [
			"When you explicitly connect a local Project folder, OpenMeld can observe supported coding-agent sessions within it. Agent Activity shares limited metadata with members of that organization and can provide context to its Center Agent.",
			"Metadata can include the agent provider, client, model, provider-supplied session title, status, Project, Git branch or commit, timestamps, and reviewed usage counters. A session title can itself contain information about your work.",
			"Agent Activity does not upload full prompts, assistant replies, reasoning, transcripts, file contents, diffs, commands, terminal output, credentials, or absolute local paths. Separate private session listings support owner-authorized selection. They do not grant other members access to native conversation history.",
			"Removing a local Project connection stops new Activity collection for that folder and clears unsent local Activity. It does not erase Activity already accepted by the cloud service or content shared through another feature.",
		],
	},
	{
		title: "5. Center Agent Memory",
		paragraphs: [
			"Completed private Center Agent conversations can create member-specific memory within your organization, including through supported private Channels. Our memory provider processes this information so the Center Agent can recall relevant facts later.",
			"Organization memory is enabled by default for recall and explicit saves from shared organization conversations. Shared conversations do not automatically create member or organization memory. Externally shared conversations do not create Center Agent memory.",
			"Member and organization memory have separate controls. Wiping member memory does not delete messages, Files, or organization memory. Disabling organization memory does not itself erase retained memory. Private recall must not disclose its private facts in a shared reply.",
		],
	},
	{
		title: "6. Apps, Channels, and Google Workspace Data",
		paragraphs: [
			"Apps connect external services. Channels let people interact with agents through messaging services such as Slack, Lark, or Feishu. We process connection identifiers, authorized messages and context, and delivery records. Provider permissions and OpenMeld's access controls determine available actions.",
			"When you connect Gmail, Google Calendar, or Google Drive, OpenMeld accesses information covered by your approved permissions. OpenMeld currently permits read-only access to Gmail, Google Calendar, and Google Drive. It does not permit sending email, changing calendar events, or creating, editing, deleting, or changing sharing permissions on Drive files.",
			"Google data and relevant derived content may be processed by our hosting, connection, and AI providers to deliver the features you authorize. Retrieved information can appear in the conversation or output you request. Review the destination before sharing private email or document content.",
			"OpenMeld's use and transfer of information received from Google APIs follows the Google API Services User Data Policy, including the Limited Use requirements. We do not sell Google user data, use it for advertising, or use it to train general-purpose AI models.",
			"People may read Google data only with your affirmative agreement to review specific data, for necessary security or bug investigation, as required by law, or in aggregated form for lawful internal operations. Transfers during a business sale require explicit prior consent under Google's policy.",
			"You can disconnect an App in OpenMeld and revoke authorization with the provider. Disconnection stops future access through that connection. It does not automatically remove content already imported, published, or copied elsewhere.",
		],
	},
	{
		title: "7. How We Use Information",
		paragraphs: [
			"We use information to authenticate accounts, enforce permissions, provide collaboration, route and run agent work, deliver notifications, and maintain content across devices. Routines and other authorized work can run without a new request for each execution.",
			"We also use information for support, failure investigation, abuse prevention, account and infrastructure security, legal obligations, and product evaluation. Operational and usage information helps us identify confusing flows and prioritize improvements.",
			"We may send service, account, security, and policy notices. Promotional messages include an unsubscribe option where required. We do not use private workspace content for unrelated advertising.",
			"Where a legal basis is required, we process information to provide the service under a contract, meet legal obligations, or pursue legitimate interests in operation, security, and improvement. We rely on consent where required. The basis depends on the information, purpose, and applicable law.",
		],
	},
	{
		title: "8. Who Can Receive Information",
		paragraphs: [
			"People and agents receive content according to the access and sharing choices for the organization, Space, File, or Channel. Team, member-private, and Space Files have different audiences. Managing an organization does not give administrators ordinary access to member-private Files.",
			"Shared links can allow access beyond current membership when their settings permit it. Revoking membership does not revoke an independent public-link grant. Recipients may keep copies or send content to an authorized external service. Private conversations and Files do not grant blanket permission to publish their contents.",
			"Providers process information needed for hosting, storage, authentication, messaging, connections, AI inference, memory, security, and support. Current services include Cloudflare for infrastructure, OpenRouter and the providers serving the selected model for hosted AI, and Zep for Center Agent memory. Providers vary by feature and model.",
			"We may disclose information when reasonably necessary to comply with law, enforce agreements, investigate abuse, or protect rights and safety. Information may transfer during a merger, acquisition, financing, or asset sale, subject to law and the Google-specific limits above.",
			"We do not sell personal information or share it for cross-context behavioral advertising.",
		],
	},
	{
		title: "9. Cookies and Storage on Your Device",
		paragraphs: [
			"Cookies support authentication, session security, protected Space access, and essential operation. The Web App uses browser storage for preferences, drafts, and permitted cached reads. Desktop and CLI components retain local settings, credentials, and operational records for their features.",
			"Browser controls can limit cookies or clear storage. This can sign you out, remove unsent drafts, or prevent features from working. Account deletion does not clear your browser, your local agent's own history, or independent recipient copies.",
			"If we introduce non-essential tracking, we will describe it and provide consent or opt-out controls where required. Operational logs and usage measurements are described in this policy.",
		],
	},
	{
		title: "10. Retention and Deletion",
		paragraphs: [
			"Retention depends on the information's purpose, active account or workspace, deletion controls, security needs, legal obligations, and backup or recovery requirements. Shared collaboration history remains with its workspace until an applicable deletion or retention process removes it.",
			"Raw Agent Activity events have a 14-day retention window. Scheduled cleanup can take longer when aggregation or cleanup is pending. Daily aggregates and digests can remain after raw events expire. Private session listings and execution records have separate lifecycles.",
			"Request account deletion in Settings → Account. If you are the last owner of a team with other members, first transfer required organization and Space ownership. Workspaces with other members remain. Workspaces with no other members close with the account.",
			"Closure revokes sign-in and starts cleanup of account-owned connections, private content, Computers, session listings, and memory. Storage or provider failures can leave cleanup pending. Closure does not mean every retained copy disappears immediately.",
			"Shared messages, published Files, Skills, revisions, and audit attribution remain with teams that continue to exist. Historical text and author snapshots are not automatically rewritten. External-service copies, local agent history, and independent recipient copies require separate action with their owners.",
			"Deleting memory, disconnecting an App, removing membership, recalling a message, and deleting an account are different actions. None guarantees erasure of every separate copy. Contact us about specific retention or deletion requests.",
		],
	},
	{
		title: "11. Your Choices and Privacy Rights",
		paragraphs: [
			"You can update account information, manage sharing, disconnect Apps, remove local Project connections, manage memory, and request account deletion. Organization-managed settings may require an owner or administrator.",
			"Depending on applicable law, you may have rights to access, correct, delete, or receive a copy of information. You may also have rights to restrict or object to processing, withdraw consent, appeal a denial, or complain to a privacy regulator. Withdrawing consent does not change the lawfulness of earlier processing.",
			`Send requests to ${LEGAL_CONTACT_EMAIL}. Describe the account or information and the action you request. We may verify your identity and an authorized agent's authority. We respond within legally required periods and explain permitted limitations or refusals.`,
			"We do not discriminate against you for exercising applicable privacy rights. When we process information for an organization, we may refer workspace-content requests to it or assist it with the request.",
		],
	},
	{
		title: "12. Security and Sensitive Information",
		paragraphs: [
			"We use authentication, access controls, encrypted transport, and operational safeguards. No service or agent workflow guarantees complete security. Protect your account, connected computers, provider credentials, and sharing settings.",
			"Do not put passwords, payment-card details, government identifiers, or other sensitive information into messages or public feedback. Use supported credential flows for connections. OpenMeld is not offered as a service certified for regulated health data or other specially regulated workloads.",
			"Public GitHub issues, pull requests, and discussions are public. OpenMeld feedback reports can include content and diagnostics you submit. Review reports before sending them.",
		],
	},
	{
		title: "13. International Processing",
		paragraphs: [
			"OpenMeld is operated by a United States company. Information may be processed in the United States and other countries where our infrastructure, AI, memory, and connected-service providers operate. Data protection laws can differ between countries.",
			`Contact ${LEGAL_CONTACT_EMAIL} for information about relevant providers and transfer arrangements. Discuss requirements for specific data residency or processing terms with us before submitting that data.`,
		],
	},
	{
		title: "14. Children's Privacy",
		paragraphs: [
			"OpenMeld is not directed to children under 13. We do not knowingly collect their personal information. Contact us if you believe a child provided information so we can investigate and take appropriate action.",
		],
	},
	{
		title: "15. Changes to This Policy",
		paragraphs: [
			"We may update this policy as our practices change. The date at the top identifies the latest revision. We give notice of material changes through the product, website, email, or another appropriate channel.",
			"Where law or a provider policy requires consent for a new use of previously collected information, we will obtain it before that use. Continued use alone does not replace that consent.",
		],
	},
	{
		title: "16. Contact",
		paragraphs: [
			`For privacy questions or rights requests, contact ${LEGAL_ENTITY_NAME} at ${LEGAL_CONTACT_EMAIL} or write to ${LEGAL_POSTAL_ADDRESS}.`,
		],
	},
] as const;

export function PrivacyPolicyPage() {
	return (
		<LegalPolicyPage
			intro="This policy explains what information OpenMeld handles, how agents and connected services use it, who can receive it, and how you can control it."
			lastUpdated={LEGAL_LAST_UPDATED}
			sections={policySections}
			summaryItems={summaryItems}
			title="Privacy Policy"
		/>
	);
}
