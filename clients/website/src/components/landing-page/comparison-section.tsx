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
	CloudCheckIcon,
	CloudIcon,
	CodeIcon,
	FileCodeIcon,
	FolderIcon,
	GitBranchIcon,
	type Icon,
	LaptopIcon,
	ListChecksIcon,
	PlugsIcon,
	ShieldCheckIcon,
	XIcon,
} from "@phosphor-icons/react";
import { websitePluginCountLabel } from "./plugin-catalog";
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

// Reviewed 2026-10-13. Scope and first-party evidence: comparison-sources.md.
// Null is unverified, never an inferred absence. Text retains narrower support.
const rows: readonly ComparisonRow[] = [
	{
		feature: "Free personal cloud computer",
		icon: CloudIcon,
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
		feature: "Cloud computer for local & remote agents",
		icon: CloudCheckIcon,
		values: [
			true,
			false,
			false,
			false,
			"Via Dust agents",
			"Via API",
			"Via SDK",
		],
	},
	{
		feature: "Built-in team chat",
		icon: ChatCircleTextIcon,
		values: [true, true, false, false, true, "Via Slack / Teams", null],
	},
	{
		feature: "Team knowledge base",
		icon: BookOpenIcon,
		values: [
			true,
			"Agent files",
			"Skills",
			"Wiki plugin",
			true,
			"Skills",
			"Skills",
		],
	},
	{
		feature: "Memory across chats",
		icon: BrainIcon,
		values: [true, true, "By runtime", true, true, true, "SDK opt-in"],
	},
	{
		feature: "Saved instructions (Skills)",
		icon: ClipboardTextIcon,
		values: [true, true, true, true, true, true, true],
	},
	{
		feature: "Shared files & folders",
		icon: FolderIcon,
		values: [true, false, null, false, true, null, "Workspace"],
	},
	{
		feature: "Previous file versions",
		icon: GitBranchIcon,
		values: [
			true,
			false,
			"Deliverables",
			"Docs only",
			null,
			"Pages only",
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
		values: [true, "Manual", "Manual", true, false, null, null],
	},
	{
		feature: "Run Codex / Claude Code",
		icon: CodeIcon,
		values: [true, true, true, true, null, null, true],
	},
	{
		feature: "Use your computer’s files",
		icon: LaptopIcon,
		values: [true, true, true, true, true, false, true],
	},
	{
		feature: "Hosted cloud agents",
		icon: CloudIcon,
		values: [true, false, false, false, true, true, true],
	},
	{
		feature: "Run tasks on a schedule",
		icon: CalendarCheckIcon,
		values: [true, true, true, true, true, true, true],
	},
	{
		feature: "Apps & plugins",
		icon: PlugsIcon,
		values: [
			websitePluginCountLabel,
			"—",
			"—",
			"—",
			"70+",
			"27 native\n3,200+ via connectors",
			"—",
		],
	},
	{
		feature: "MIT-licensed core",
		icon: FileCodeIcon,
		values: [true, false, false, true, true, false, true],
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
