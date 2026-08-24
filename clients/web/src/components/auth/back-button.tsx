import { buttonVariants } from "@openmeld/ui/components/button";
import { Link } from "@tanstack/react-router";

export function BackButton() {
	return (
		<Link
			className={`${buttonVariants({ size: "sm", variant: "outline" })} absolute top-4 left-4 h-11 w-16 text-muted-foreground hover:text-foreground active:scale-95 lg:h-7`}
			to="/"
		>
			Home
		</Link>
	);
}
