import { collectMessageLinks } from "@openmeld/protocol";
import { Fragment, useMemo } from "react";

export function MessageLinksText({ text }: { text: string }) {
	const links = useMemo(() => collectMessageLinks(text), [text]);
	let offset = 0;
	return (
		<>
			{links.map((link) => {
				const before = text.slice(offset, link.start);
				offset = link.end;
				return (
					<Fragment key={link.start}>
						{before}
						<a
							className="text-primary underline-offset-4 hover:underline focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
							href={link.url}
							onClick={(event) => event.stopPropagation()}
							rel="noopener noreferrer"
							target="_blank"
						>
							{link.label}
						</a>
					</Fragment>
				);
			})}
			{text.slice(offset)}
		</>
	);
}
