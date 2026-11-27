import { Button, buttonVariants } from "@openmeld/ui/components/button";

export function InboxTodoActions(input: {
	title: string;
	open: { href: string } | { onOpen: () => void };
	onDone: () => void;
	onIgnore: () => void;
}) {
	return (
		<div className="flex flex-wrap items-center gap-1">
			{"href" in input.open ? (
				<a
					aria-label={`Open: ${input.title}`}
					className={buttonVariants({ size: "sm", variant: "secondary" })}
					href={input.open.href}
					rel="noopener noreferrer"
					target="_blank"
				>
					Open
				</a>
			) : (
				<Button onClick={input.open.onOpen} size="sm" variant="secondary">
					Open
				</Button>
			)}
			<Button
				aria-label={`Done: ${input.title}`}
				onClick={input.onDone}
				size="sm"
				title="Complete in TODO without changing the source"
				variant="ghost"
			>
				Done
			</Button>
			<Button
				aria-label={`Ignore: ${input.title}`}
				onClick={input.onIgnore}
				size="sm"
				variant="ghost"
			>
				Ignore
			</Button>
		</div>
	);
}
