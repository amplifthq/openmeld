import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@openmeld/ui/components/table";
import {
	BookOpenIcon,
	BrainIcon,
	CalendarCheckIcon,
	ChatCircleTextIcon,
	CheckIcon,
	ClipboardTextIcon,
	CloudIcon,
	CodeIcon,
	DesktopIcon,
	FileCodeIcon,
	FolderIcon,
	GitBranchIcon,
	type Icon,
	LaptopIcon,
	ListChecksIcon,
	PlugsIcon,
	ShareNetworkIcon,
	ShieldCheckIcon,
	XIcon,
} from "@phosphor-icons/react";
import "./comparison-section.css";

const products = [
	{ name: "OpenMeld", url: null },
	{ name: "Raft", url: "https://raft.build/" },
	{ name: "Multica", url: "https://multica.ai/" },
	{ name: "Paperclip", url: "https://paperclip.ing/" },
	{ name: "Dust", url: "https://dust.tt/" },
	{ name: "Viktor", url: "https://viktor.com/" },
	{ name: "OpenHands", url: "https://www.openhands.dev/" },
] as const;

type ComparisonValue = boolean | string | null;
type ComparisonRow = {
	feature: string;
	icon: Icon;
	values: readonly [
		ComparisonValue,
		ComparisonValue,
		ComparisonValue,
		ComparisonValue,
		ComparisonValue,
		ComparisonValue,
		ComparisonValue,
	];
};

// Reviewed 2026-10-15. Scope and first-party evidence: comparison-sources.md.
// Null is unverified, never an inferred absence. Text retains narrower support.
const rows: readonly ComparisonRow[] = [
	{
		feature: "Run your local agents",
		icon: CodeIcon,
		values: [true, true, true, true, null, null, true],
	},
	{
		feature: "Built-in team chat",
		icon: ChatCircleTextIcon,
		values: [
			true,
			true,
			"Issue threads",
			"Issue threads",
			true,
			"Via Slack / Teams",
			null,
		],
	},
	{
		feature: "Tasks for people & agents",
		icon: ListChecksIcon,
		values: [true, true, true, true, true, "Agent tasks", "Agent tasks"],
	},
	{
		feature: "Require task approval",
		icon: ShieldCheckIcon,
		values: [
			"Configurable",
			"Manual",
			"Manual",
			"Configurable",
			false,
			null,
			null,
		],
	},
	{
		feature: "Shared files & folders",
		icon: FolderIcon,
		values: [
			true,
			"Attachments / app",
			"Issue files",
			"Issue files",
			true,
			"Chat files",
			"Workspace",
		],
	},
	{
		feature: "Public sharing links",
		icon: ShareNetworkIcon,
		values: [
			"Spaces",
			"Artifacts app",
			null,
			null,
			"Frames",
			"Pages & apps",
			"Conversations",
		],
	},
	{
		feature: "Hosted cloud agents",
		icon: CloudIcon,
		values: [
			true,
			"Own compute",
			"Own compute",
			"Cloud waitlist",
			true,
			true,
			true,
		],
	},
	{
		feature: "Free personal cloud computer",
		icon: DesktopIcon,
		values: [
			true,
			false,
			false,
			false,
			"Starter credits",
			"Starter credits",
			"Free cloud tier",
		],
	},
	{
		feature: "Work in your local folders",
		icon: LaptopIcon,
		values: [true, true, true, true, "Via CLI", false, true],
	},
	{
		feature: "Team knowledge base",
		icon: BookOpenIcon,
		values: [
			true,
			"Agent files",
			"Skills / projects",
			"Wiki plugin",
			true,
			"Skills",
			"Skills",
		],
	},
	{
		feature: "Memory across chats",
		icon: BrainIcon,
		values: [
			"Center Agent",
			true,
			"By runtime",
			"Skills / connectors",
			"Memory tool",
			true,
			"SDK opt-in",
		],
	},
	{
		feature: "Saved instructions (Skills)",
		icon: ClipboardTextIcon,
		values: [true, true, true, true, true, true, true],
	},
	{
		feature: "Previous file versions",
		icon: GitBranchIcon,
		values: [
			true,
			"Artifacts app",
			"Deliverables",
			"Docs / Wiki",
			"Frames",
			"Pages only",
			null,
		],
	},
	{
		feature: "Run tasks on a schedule",
		icon: CalendarCheckIcon,
		values: [true, "Managed agents", true, true, true, true, true],
	},
	{
		feature: "Apps & plugins",
		icon: PlugsIcon,
		values: [
			"Plugin catalog",
			"App marketplace",
			"Chat / Git / MCP",
			"Connectors / plugins",
			"Connectors / MCP",
			"Native / connectors",
			"Plugins / MCP",
		],
	},
	{
		feature: "Core license",
		icon: FileCodeIcon,
		values: [
			"MIT",
			"FSL-1.1-ALv2",
			"Apache + terms",
			"MIT",
			"MIT",
			"Proprietary",
			"MIT",
		],
	},
];

function ComparisonCell({ value }: { value: ComparisonValue }) {
	if (typeof value === "boolean") {
		const Icon = value ? CheckIcon : XIcon;
		return (
			<>
				<Icon
					aria-hidden
					className={value ? "meld-comparison-yes" : "meld-comparison-no"}
					size={22}
					weight="bold"
				/>
				<span className="sr-only">{value ? "Supported" : "Not supported"}</span>
			</>
		);
	}
	if (value === null) {
		return (
			<>
				<span aria-hidden className="meld-comparison-unknown">
					?
				</span>
				<span className="sr-only">Unverified</span>
			</>
		);
	}
	return <span className="meld-comparison-value">{value}</span>;
}

export function ComparisonSection() {
	return (
		<section
			aria-labelledby="comparison-title"
			className="meld-section meld-wrap meld-comparison"
			id="compare"
		>
			<h2 id="comparison-title">
				Your team’s work.
				<br />
				<span>All in one place.</span>
			</h2>
			<Table
				aria-labelledby="comparison-title"
				className="meld-comparison-table"
			>
				<colgroup>
					<col className="meld-comparison-feature-column" />
					{products.map((product) => (
						<col key={product.name} />
					))}
				</colgroup>
				<TableHeader>
					<TableRow>
						<TableHead scope="col">Features</TableHead>
						{products.map((product) => (
							<TableHead key={product.name} scope="col">
								{product.url ? (
									<a
										aria-label={`${product.name} website (opens in a new tab)`}
										className="meld-comparison-product-link"
										href={product.url}
										rel="noopener noreferrer"
										target="_blank"
									>
										{product.name}
									</a>
								) : (
									product.name
								)}
							</TableHead>
						))}
					</TableRow>
				</TableHeader>
				<TableBody>
					{rows.map((row) => (
						<TableRow key={row.feature}>
							<TableHead scope="row">
								<span className="meld-comparison-feature">
									<row.icon aria-hidden size={18} />
									<span>{row.feature}</span>
								</span>
							</TableHead>
							{row.values.map((value, index) => (
								<TableCell key={products[index].name}>
									<ComparisonCell value={value} />
								</TableCell>
							))}
						</TableRow>
					))}
				</TableBody>
			</Table>
		</section>
	);
}
