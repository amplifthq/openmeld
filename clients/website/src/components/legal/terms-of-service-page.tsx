import {
	LEGAL_CONTACT_EMAIL,
	LEGAL_ENTITY_NAME,
	LEGAL_LAST_UPDATED,
	LEGAL_POSTAL_ADDRESS,
} from "./legal-policy-details";
import { LegalPolicyPage } from "./legal-policy-page";

const summaryItems = [
	{
		label: "Service",
		text: "OpenMeld provides shared workspaces, local and hosted AI agents, Files, Tasks, Routines, and connected Apps and Channels.",
	},
	{
		label: "Your responsibility",
		text: "Connect only systems and data you are allowed to use. Set appropriate permissions and review important agent actions and results.",
	},
	{
		label: "Your content",
		text: "You keep your rights in your content. We receive the limited permissions needed to provide the service and perform your authorized work.",
	},
	{
		label: "Contact",
		text: `Send questions or legal notices to ${LEGAL_CONTACT_EMAIL}.`,
	},
] as const;

const termsSections = [
	{
		title: "1. Agreement and Service Provider",
		paragraphs: [
			`These Terms of Service are an agreement between you and ${LEGAL_ENTITY_NAME} ("Amplift," "we," "us," or "our"). Our mailing address is ${LEGAL_POSTAL_ADDRESS}.`,
			"These terms govern the OpenMeld website, hosted service, Web App, Desktop app, CLI, local OpenMeld Service, and related hosted features. By creating an account or using the service, you agree to these terms. If you do not agree, do not use the service.",
			"If you use OpenMeld for an organization, you must have authority to bind that organization. In that case, 'you' includes the organization. Our Privacy Policy explains how we handle personal information. A separate signed service agreement controls where it conflicts with these terms.",
		],
	},
	{
		title: "2. Eligibility, Accounts, and Security",
		paragraphs: [
			"You must be at least 13 and legally able to enter this agreement. If you are below the age of legal majority, your parent or legal guardian must agree on your behalf. You must also meet any higher age requirement in your jurisdiction or a connected provider's terms.",
			"Provide accurate account information and secure your authentication methods. Tell us promptly about suspected unauthorized access. You are responsible for authorized activity through your account and for securing computers, agents, and connections you control, subject to applicable law.",
			"Do not share credentials or use another person's account to bypass organization, resource, or permission boundaries. We may check identity or authority for sensitive operations.",
		],
	},
	{
		title: "3. Organizations, Sharing, and Permissions",
		paragraphs: [
			"Organizations and Spaces control membership and shared work. Owners and administrators manage resources and policies their roles permit. Their role does not grant unrestricted access to member-private Files, native local agent history, or personal connections.",
			"You are responsible for the audience selected for messages, Files, shared links, Apps, and Channels. A permitted shared link can allow access independently of membership. Recipients can retain copies after you remove access to the original.",
			"Review access before inviting a person or agent. Sharing with an agent can cause information to be processed by its authorized tools and model providers. You must have authority to make that disclosure.",
		],
	},
	{
		title: "4. Agents, Computers, Tasks, and Routines",
		paragraphs: [
			"OpenMeld coordinates Local Agents on connected computers and Hosted Remote Agents, including the Center Agent. A Wake asks an Agent Profile to do work. An authorized agent can read context, run commands, change files, and use connected services within available controls.",
			"You must have permission to use the computer, repository, account, and information involved. Configure agent permissions for the intended work. A permission mode or approval prompt does not guarantee a harmless result or separate confirmation for every action.",
			"Tasks and Routines can continue, resume, or run on a schedule under your authorization. Review their scope, destination, and service access. Pause or stop work when authorization no longer applies. A stop request does not reverse completed actions in OpenMeld or an external system.",
			"Agent Activity provides limited awareness of connected Project sessions. It does not claim work ownership, prove completion, or grant execution authority. Local execution can send information to a model provider or publish results to OpenMeld.",
		],
	},
	{
		title: "5. Connected Apps, Channels, and Other Providers",
		paragraphs: [
			"Choose only services you are allowed to connect and comply with their terms. Member-owned and organization-shared connections can have different audiences and actions. Channel replies are subject to the messaging service's audience and retention rules.",
			"For a connected Google account, OpenMeld currently permits approved read access to Gmail, Google Calendar, and Google Drive. It does not authorize sending email, changing calendar events, or writing or changing sharing permissions on Drive files. Other Apps may support writes when their permissions and OpenMeld's controls allow them.",
			"Disconnection stops future access through that connection. It does not undo actions or remove content copied or published elsewhere. You can also revoke authorization with the provider.",
			"External providers control their availability, prices, limits, and data practices. Your obligations under their agreements continue. We remain responsible for our obligations under these terms and applicable law.",
		],
	},
	{
		title: "6. Your Content and AI Output",
		paragraphs: [
			"You retain your rights in submitted content. You grant us a non-exclusive license to host, store, reproduce, process, transmit, and display it to provide, secure, maintain, and support OpenMeld. This includes authorized sharing, agent execution, memory, revisions, and backup or recovery. We may use service providers for these purposes.",
			"This license does not transfer ownership or permit unrelated advertising. It continues only as needed for permitted retention, shared history, and legal obligations described in the Privacy Policy.",
			"You must have the rights and permissions needed to submit content, instruct agents, and share results. Do not submit information you are not allowed to disclose. You are responsible for lawful instructions and use of outputs.",
			"To the extent we hold transferable rights in output generated for you, we assign them to you. Output may not be unique or qualify for intellectual property protection. It may include third-party material. This assignment does not override others' rights or applicable software and content licenses.",
		],
	},
	{
		title: "7. Acceptable Use",
		paragraphs: [
			"Do not use OpenMeld to violate laws or rights, access systems without authorization, distribute malware, commit fraud, harass or exploit people, or disclose information unlawfully.",
			"Do not bypass permissions, usage limits, or security measures. Do not disrupt the service or interfere with users. Follow applicable export controls, sanctions, and restrictions on your systems and data.",
			`Report suspected security issues to ${LEGAL_CONTACT_EMAIL}. Contact us before production testing that could affect users, availability, or private information. These terms do not restrict rights granted by an applicable open-source license.`,
		],
	},
	{
		title: "8. AI Limitations and Experimental Features",
		paragraphs: [
			"AI output can be incorrect, incomplete, misleading, or unsafe. Agents can misunderstand instructions and take unintended actions. Check important results, inspect changes, and keep appropriate backups and human oversight.",
			"Do not rely on OpenMeld as the only control for medical, legal, financial, safety-critical, or other high-risk decisions. OpenMeld does not provide professional advice or replace a qualified professional.",
			"OpenMeld includes experimental features. We may change or discontinue features, models, integrations, or limits. Experimental status does not remove our legal obligations or commitments under the Privacy Policy or a signed agreement.",
		],
	},
	{
		title: "9. Fees and Third-Party Costs",
		paragraphs: [
			"Any paid OpenMeld offering requires the pricing and payment terms presented for that offering or a separate written agreement. A usage display or estimated model cost is not an invoice or authorization for a new paid subscription.",
			"You remain responsible for separate subscriptions and charges from agent tools, model providers, and external services. A Local Agent using your provider account can consume its allowance or incur charges under its terms.",
			"If we introduce a paid offering, its purchase terms must explain price, billing period, usage charges, renewal, cancellation, and refund conditions. Updating these terms alone does not create a paid commitment. Mandatory consumer rights continue to apply.",
		],
	},
	{
		title: "10. Open Source and Our Service",
		paragraphs: [
			"OpenMeld source code is MIT-licensed open-source software. Applicable component licenses govern use, modification, and distribution of code. These terms govern the hosted service and do not remove open-source license rights.",
			"We and our licensors retain rights in the hosted service, branding, and materials other than your content. These terms permit service use under this agreement, not ownership of our trademarks or infrastructure.",
			"Public repositories are not private support channels. Do not post credentials, private content, or confidential diagnostics in public issues or pull requests.",
		],
	},
	{
		title: "11. Account Closure, Content, and Retention",
		paragraphs: [
			"You may stop using OpenMeld at any time. Request account deletion in Settings → Account. A last owner of a team with other members must transfer required organization and Space ownership first.",
			"Closure revokes sign-in and begins cleanup of private account-owned resources. Workspaces with no other members close. Teams with other members continue, and shared messages, published Files, Skills, revisions, and audit attribution remain with them.",
			"Cleanup can take time and depend on external providers. Local agent history and independent recipient copies are outside that cleanup. Disconnection, memory deletion, membership removal, and account deletion have different effects, as the Privacy Policy explains.",
			"Keep copies you need before deleting resources or closing an account. We do not promise indefinite retention or recovery after deletion. Legal obligations or a separate signed agreement can require additional retention or data access.",
		],
	},
	{
		title: "12. Suspension, Termination, and Service Changes",
		paragraphs: [
			"We may restrict or suspend access when reasonably necessary to protect people or the service, investigate abuse, comply with law, or address a material violation. Where practical, we give notice and a reasonable opportunity to correct the problem. Urgent security or legal circumstances can require immediate action.",
			"We may discontinue the service with reasonable notice where practical. We do not guarantee availability, recovery, or feature permanence unless a signed agreement provides otherwise. We honor applicable legal obligations when changing or ending the service.",
			"Terms that must continue by their nature survive termination. These include ownership, permitted retention, accrued payment obligations, disclaimers, liability limits, and dispute provisions.",
		],
	},
	{
		title: "13. Disclaimers",
		paragraphs: [
			"To the fullest extent permitted by law, OpenMeld is provided 'as is' and 'as available.' We disclaim implied warranties of merchantability, fitness for a particular purpose, title, and non-infringement. We do not warrant uninterrupted operation, error-free output, or a particular agent result.",
			"These disclaimers do not exclude protections that law does not allow us to exclude. A signed service agreement can provide additional commitments.",
		],
	},
	{
		title: "14. Limitation of Liability",
		paragraphs: [
			"To the fullest extent permitted by law, neither party is liable for indirect, incidental, special, consequential, or punitive damages arising from this agreement. These include lost profits, revenue, business opportunities, or goodwill.",
			"To the fullest extent permitted by law, Amplift's total liability under this agreement is limited to the greater of US $100 or your OpenMeld payments in the 12 months before the event giving rise to the claim.",
			"These limits do not apply to fraud, willful misconduct, gross negligence, or liability that law does not permit us to limit. They do not restrict mandatory consumer rights or override a separate signed agreement's liability provisions.",
		],
	},
	{
		title: "15. Governing Law and Disputes",
		paragraphs: [
			`Contact ${LEGAL_CONTACT_EMAIL} about a dispute so we can try to resolve it. This does not prevent urgent relief or exercising rights within a legal deadline.`,
			"Delaware law governs this agreement, without applying its conflict-of-laws rules. Subject to mandatory legal rights, courts with jurisdiction in Delaware are the agreed venue for disputes under this agreement.",
			"Consumers keep mandatory protections under the laws of their residence and any right to bring a claim in a local court. These terms do not require arbitration or waive participation in a class action.",
		],
	},
	{
		title: "16. Changes and General Terms",
		paragraphs: [
			"We may update these terms. We give reasonable advance notice of material changes through the product, website, email, or another appropriate channel. Immediate legal or security changes may be an exception. The notice states when changes take effect.",
			"Continued use after that date means acceptance, except where law requires a different process. If you disagree, stop using the service. Changes do not retroactively remove accrued rights.",
			"These terms and applicable signed service agreements form the agreement for OpenMeld. If a provision is unenforceable, the others continue. Delayed enforcement is not a waiver. Neither party may transfer this agreement except with consent or in a lawful business reorganization or transfer, subject to applicable law.",
		],
	},
	{
		title: "17. Contact",
		paragraphs: [
			`Send questions or legal notices to ${LEGAL_ENTITY_NAME} at ${LEGAL_CONTACT_EMAIL} or write to ${LEGAL_POSTAL_ADDRESS}.`,
		],
	},
] as const;

export function TermsOfServicePage() {
	return (
		<LegalPolicyPage
			intro="These terms explain your rights and responsibilities when you use OpenMeld's collaboration service, AI agents, connected computers, and external services."
			lastUpdated={LEGAL_LAST_UPDATED}
			sections={termsSections}
			summaryItems={summaryItems}
			title="Terms of Service"
		/>
	);
}
