import { collectMessageLinks } from "@openmeld/protocol";
import { Fragment, useMemo } from "react";
import { DesktopAwareLink } from "#/desktop/desktop-aware-link";

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
						<DesktopAwareLink
							className="text-primary underline-offset-4 hover:underline focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
							href={link.url}
							onClick={(event) => event.stopPropagation()}
							rel="noopener noreferrer"
							target="_blank"
						>
							{link.label}
						</DesktopAwareLink>
					</Fragment>
				);
			})}
			{text.slice(offset)}
		</>
	);
}
