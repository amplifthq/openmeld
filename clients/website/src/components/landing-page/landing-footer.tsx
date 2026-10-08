import { OpenMeldLogoStrong } from "@openmeld/ui/components/openmeld-logo-strong";
import { LandingPageFooterLogo } from "./landing-page-footer-logo";
import "./landing-footer.css";

export function LandingFooter({ repositoryUrl }: { repositoryUrl: string }) {
	return (
		<footer className="meld-page-footer">
			<div className="meld-footer-top meld-wrap">
				<div>
					<a
						aria-label="OpenMeld homepage"
						className="meld-brand meld-brand-motion"
						href="/"
					>
						<OpenMeldLogoStrong
							ariaLabel={null}
							pointerTracking="viewport"
							size={4}
						/>
					</a>
					<p>Built in the open.</p>
				</div>
				<nav aria-label="Footer">
					<a href="https://docs.openmeld.ai">Docs</a>
					<a href="/changelog">Changelog</a>
					<a href={repositoryUrl}>GitHub</a>
					<a href="/privacy">Privacy</a>
					<a href="/terms">Terms</a>
				</nav>
			</div>
			<LandingPageFooterLogo />
		</footer>
	);
}
