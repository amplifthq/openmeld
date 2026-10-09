import { Surface } from "@openmeld/ui/fluid/surface";
import {
	ArrowRightIcon,
	ArrowUpRightIcon,
	GithubLogoIcon,
	ShieldCheckIcon,
} from "@phosphor-icons/react";
import "./trust-section.css";

export function TrustSection({ repositoryUrl }: { repositoryUrl: string }) {
	return (
		<section
			aria-labelledby="trust-title"
			className="meld-section meld-wrap meld-trust-section"
			id="trust"
		>
			<div className="meld-section-heading">
				<h2 id="trust-title">
					Your work, protected.
					<br />
					<span>Our code, open.</span>
				</h2>
				<p>
					Know how your data is handled. Explore the code before you connect
					your team.
				</p>
			</div>
			<div className="meld-trust-grid">
				<Surface className="meld-trust-card">
					<ShieldCheckIcon aria-hidden size={28} weight="light" />
					<h3>Private by default.</h3>
					<p>
						Your conversations and model inputs and outputs stay out of routine
						production logs. Automatic agent reports leave out generated
						summaries and details of your work.
					</p>
					<p>
						Diagnostics keep operational facts like usage, status, and timing.
						Your workspace history stays available in the app.
					</p>
					<a className="meld-link meld-trust-link" href="/privacy">
						Read our privacy policy <ArrowRightIcon aria-hidden size={16} />
					</a>
				</Surface>
				<Surface className="meld-trust-card">
					<GithubLogoIcon aria-hidden size={28} weight="light" />
					<h3>Open source. Yours to inspect.</h3>
					<p>
						OpenMeld is MIT licensed. Read the source, follow the changes, and
						investigate how it works.
					</p>
					<p>
						Report a bug in an <a href={`${repositoryUrl}/issues`}>issue</a>, or
						contribute a fix with a{" "}
						<a href={`${repositoryUrl}/pulls`}>pull request</a>. Both are
						welcome.
					</p>
					<a className="meld-link meld-trust-link" href={repositoryUrl}>
						Explore the code <ArrowUpRightIcon aria-hidden size={16} />
					</a>
				</Surface>
			</div>
		</section>
	);
}
