import { Link } from "@tanstack/react-router";
import { PublicPageHeader } from "#/components/app/public-page-header";
import {
	APP_PAGE_FRAME_CLASS_NAME,
	APP_PAGE_FRAME_PADDING_CLASS_NAME,
} from "#/components/app/shell-layout";

const LAST_UPDATED = "August 13, 2026";
const PRIVACY_EMAIL = "felix@amplift.ai";

const summaryItems = [
	{
		label: "Product",
		text: "OpenMeld helps people and local AI agents work together in cloud Spaces while agent execution runs through computers the user connects.",
	},
	{
		label: "Stage",
		text: "OpenMeld is experimental. The product, data model, retention periods, and connected-agent behavior may change as the service evolves.",
	},
	{
		label: "License",
		text: "The OpenMeld source code is MIT-licensed open-source software. The hosted service, user accounts, and operational data are still governed by this policy.",
	},
	{
		label: "Contact",
		text: `Privacy questions and rights requests can be sent to ${PRIVACY_EMAIL}.`,
	},
] as const;

const policySections = [
	{
		title: "1. What This Policy Covers",
		paragraphs: [
			"This Privacy Policy explains how Amplift handles information when you use OpenMeld, including the OpenMeld web app, hosted service, CLI-supported setup flow, optional desktop surfaces, and the local OpenMeld Service that connects your computer to OpenMeld.",
			"OpenMeld is built around Spaces, Agent Profiles, connected computers, and Wakes. A Wake sends work from a Space to a local agent runtime such as Codex, Claude Code, Cursor, Grok Build, or OpenCode through a computer you connect. The conversation and visible outcome live in OpenMeld. The local execution environment remains on your machine unless content is sent back into a Space.",
			"This policy is written for an experimental product. It should be reviewed by qualified privacy counsel before it is treated as complete legal compliance for any specific jurisdiction.",
		],
	},
	{
		title: "2. Information We Collect",
		paragraphs: [
			"Account information: name, email address, authentication state, profile details, organization membership, invitation status, and security events needed to keep your account working.",
			"Workspace content: Space names, messages, mentions, replies, Wake targets, Agent Profile names, instructions you choose to provide, agent replies, visible failures, and related collaboration metadata.",
			"Connected-computer and agent information: device identifiers, service health, CLI or OpenMeld Service version, operating-system family, local agent availability, Binding state, readiness summaries, setup status, and diagnostic pointers needed to route Wakes and explain failures.",
			"Usage and technical information: IP address, browser type, request metadata, session cookies, logs, timestamps, feature usage, errors, and security signals needed to operate, secure, debug, and improve OpenMeld.",
			"Support communications: messages you send us, including privacy requests, bug reports, feedback, or other communications.",
		],
	},
	{
		title: "3. Information We Do Not Intend to Collect",
		paragraphs: [
			"OpenMeld is not designed for children's data, regulated health data, payment-card data, biometric data, government identifiers, or other sensitive personal information. Do not put that kind of information into OpenMeld unless you have independently confirmed that your use is lawful and appropriate.",
			"OpenMeld does not need your private repository contents, terminal output, local files, or agent-provider credentials unless you or a connected agent intentionally place that information into a Space, setup flow, diagnostic report, or support communication.",
		],
	},
	{
		title: "4. How We Use Information",
		paragraphs: [
			"We use information to provide OpenMeld: authenticate accounts, create Spaces, show members, route Wakes, connect local OpenMeld Service instances, display replies or explicit failures, and keep the product usable across devices.",
			"We use information to secure and debug OpenMeld: prevent abuse, investigate errors, preserve diagnostic context, understand service health, and repair broken setup or Wake paths.",
			"We use information to improve OpenMeld: understand which flows are confusing, prioritize product fixes, and measure whether experimental features are working. We avoid using private Space content for unrelated marketing purposes.",
			"We may use contact information to send service, security, account, or policy notices. If we add promotional email, we will provide an unsubscribe path where required.",
		],
	},
	{
		title: "5. Local Agents and Third-Party Tools",
		paragraphs: [
			"OpenMeld coordinates local agent execution, but local agent tools and model providers are separate products. When a Wake reaches a local runtime, that runtime may process prompts, repository context, terminal output, or other local data under its own terms and privacy practices.",
			"You are responsible for the agent tools, accounts, subscriptions, permissions, repositories, and machines you connect. Do not connect OpenMeld to a machine or agent runtime unless you are allowed to use that environment for the work you send.",
		],
	},
	{
		title: "6. Connected Apps and Google Workspace Data",
		paragraphs: [
			"When you connect Gmail, Google Calendar, or Google Drive, OpenMeld accesses only the Google Workspace data covered by the permissions you approve. Depending on the App and the request you make, this can include email messages, drafts, labels, and settings; calendars, events, and sharing information; or Drive files and file metadata.",
			"OpenMeld uses that data only to provide or improve the user-facing features you ask for. For example, your Center Agent may find an email, draft or send a message, read or change an event, or find, read, create, update, or delete a Drive file when your request and approved permissions allow that action. You can disconnect a Google account from OpenMeld at any time.",
			"OpenMeld's use and transfer of information received from Google APIs follows the Google API Services User Data Policy, including the Limited Use requirements. We do not sell Google user data, use it for advertising, or allow people to read it unless you affirmatively ask us to review specific data, it is necessary for security or abuse investigation, it is required by law, or the data has been aggregated for lawful internal operations.",
		],
	},
	{
		title: "7. How We Share Information",
		paragraphs: [
			"We share information with infrastructure and service providers that help us host, authenticate, deliver email, secure, observe, and operate OpenMeld. They may process information only as needed to provide those services to us.",
			"We share information inside Spaces and Organizations according to the collaboration choices you make. If you invite people or agents into a Space, they can see the content and context available in that Space.",
			"We may disclose information if required by law, to protect rights and safety, to prevent abuse, or as part of a business transfer such as a merger, acquisition, or reorganization.",
			"We do not sell personal information.",
		],
	},
	{
		title: "8. Cookies and Authentication",
		paragraphs: [
			"OpenMeld uses essential cookies and similar technologies for login, session security, protected Space access, request routing, and fraud prevention.",
			"If OpenMeld adds non-essential analytics, advertising, or marketing tracking, we will update this policy and provide consent or opt-out controls where required by law.",
		],
	},
	{
		title: "9. Retention",
		paragraphs: [
			"We keep account, Space, organization, Wake, setup, diagnostic, and security records for as long as needed to operate OpenMeld, preserve collaboration history, debug failures, protect the service, comply with legal obligations, and support reasonable backup and audit needs.",
			"Because OpenMeld is experimental, retention periods and deletion flows may change. Where applicable law gives you deletion or correction rights, contact us and we will handle the request according to the law that applies.",
		],
	},
	{
		title: "10. Your Choices and Rights",
		paragraphs: [
			"Depending on where you live, you may have rights to access, correct, delete, export, restrict, or object to certain processing of your personal information. You may also have the right to complain to a data protection authority.",
			`To make a privacy request, email us at ${PRIVACY_EMAIL}. We may need to verify your identity before acting on the request.`,
			"California, Colorado, Connecticut, Utah, Virginia, European Economic Area, United Kingdom, and other privacy laws can impose specific requirements. This policy is intended to be transparent, but it is not a substitute for jurisdiction-specific legal review.",
		],
	},
	{
		title: "11. Security",
		paragraphs: [
			"We use technical and organizational safeguards such as authentication, access controls, encrypted transport, operational logging, and diagnostic review to protect OpenMeld.",
			"No internet service, local daemon, browser session, CLI, or AI-agent workflow is perfectly secure. OpenMeld is experimental and should not be used as the only control for mission-critical, safety-critical, financial, medical, legal, or other high-risk decisions.",
		],
	},
	{
		title: "12. International Processing",
		paragraphs: [
			"OpenMeld is intended primarily for North American users, but information may be processed in the United States and other countries where our service providers operate.",
			"If international transfer rules apply to your use, additional terms, safeguards, or agreements may be required before OpenMeld is appropriate for that use.",
		],
	},
	{
		title: "13. Open Source, MIT License, and Service Limits",
		paragraphs: [
			"OpenMeld's source code is available under the MIT License. That license lets people inspect, copy, modify, and distribute the software under its terms, but it does not create warranties, service-level commitments, privacy guarantees, or legal advice.",
			"Public GitHub issues, pull requests, discussions, and contributions are public by design. Do not post secrets, private Space content, personal data, or confidential customer information in public open-source channels.",
		],
	},
	{
		title: "14. Children's Privacy",
		paragraphs: [
			"OpenMeld is not directed to children under 13, and we do not knowingly collect personal information from children under 13. If you believe a child has provided personal information, contact us so we can review and delete it where appropriate.",
		],
	},
	{
		title: "15. Changes to This Policy",
		paragraphs: [
			"We may update this policy as OpenMeld changes. When changes are material, we will provide notice through the product, website, email, repository, or another reasonable channel.",
			"Your continued use of OpenMeld after an updated policy becomes effective means the updated policy applies to later use.",
		],
	},
	{
		title: "16. Contact",
		paragraphs: [
			`For privacy questions, rights requests, or concerns about this policy, contact Amplift at ${PRIVACY_EMAIL}.`,
			"If you need legal advice about whether OpenMeld is appropriate for your organization, data, jurisdiction, or compliance obligations, speak with qualified counsel.",
		],
	},
] as const;

export function PrivacyPolicyPage() {
	return (
		<main className="min-h-svh bg-background">
			<PublicPageHeader />

			<section
				className={`mx-auto w-full ${APP_PAGE_FRAME_PADDING_CLASS_NAME} ${APP_PAGE_FRAME_CLASS_NAME}`}
			>
				<div className="relative px-6 py-14 sm:px-10 sm:py-16 lg:px-14">
					<div
						aria-hidden
						className="absolute inset-y-0 left-0 w-px bg-foreground/10"
					/>
					<div
						aria-hidden
						className="absolute inset-y-0 right-0 w-px bg-foreground/10"
					/>

					<div className="max-w-3xl">
						<p className="font-geist-pixel-line text-muted-foreground text-xs uppercase tracking-normal">
							Last updated {LAST_UPDATED}
						</p>
						<h1 className="mt-4 text-balance font-semibold text-4xl tracking-normal sm:text-5xl">
							Privacy Policy
						</h1>
						<p className="mt-5 max-w-2xl text-base text-muted-foreground leading-7">
							OpenMeld is an experimental collaboration loop for humans, Spaces,
							and local AI agents. This policy explains what we collect, why we
							collect it, how local execution fits in, and what limits you
							should understand before using the service.
						</p>

						<div className="mt-10 grid gap-4 border-foreground/10 border-y py-6 sm:grid-cols-2">
							{summaryItems.map((item) => (
								<section className="space-y-2" key={item.label}>
									<h2 className="font-medium text-sm">{item.label}</h2>
									<p className="text-muted-foreground text-sm leading-6">
										{item.text}
									</p>
								</section>
							))}
						</div>

						<div className="mt-10 space-y-10">
							{policySections.map((section) => (
								<section className="space-y-4" key={section.title}>
									<h2 className="font-semibold text-xl">{section.title}</h2>
									{section.paragraphs.map((paragraph) => (
										<p
											className="text-muted-foreground text-sm leading-7"
											key={paragraph}
										>
											{paragraph}
										</p>
									))}
								</section>
							))}
						</div>

						<div className="mt-12 border-foreground/10 border-t pt-6">
							<Link
								className="text-muted-foreground text-sm transition-colors hover:text-foreground"
								to="/login"
							>
								Back to login
							</Link>
						</div>
					</div>
				</div>
			</section>
		</main>
	);
}
