import { Surface } from "@openmeld/ui/fluid/surface";
import { ArrowRightIcon, ArrowUpRightIcon } from "@phosphor-icons/react";
import { LandingFigure } from "./landing-figure";
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
					<div className="meld-trust-figure">
						<LandingFigure
							figure="lockers"
							label="Individual lockers. Move across to inspect a compartment."
						/>
					</div>
					<h3>Private by default.</h3>
					<p>
						Your conversations and model inputs and outputs stay out of routine
						production logs. Automatic agent reports omit work summaries and
						details.
					</p>
					<a className="meld-link meld-trust-link" href="/privacy">
						Read our privacy policy <ArrowRightIcon aria-hidden size={16} />
					</a>
				</Surface>
				<Surface className="meld-trust-card">
					<div className="meld-trust-figure">
						<LandingFigure
							figure="branches"
							label="Code changes branching and merging. Move across to follow their history."
						/>
					</div>
					<h3>Open source. Yours to inspect.</h3>
					<p>MIT licensed. Read the source and see how OpenMeld works.</p>
					<p>
						Report an <a href={`${repositoryUrl}/issues`}>issue</a> or
						contribute a <a href={`${repositoryUrl}/pulls`}>pull request</a>.
						Both are welcome.
					</p>
					<a className="meld-link meld-trust-link" href={repositoryUrl}>
						Explore the code <ArrowUpRightIcon aria-hidden size={16} />
					</a>
				</Surface>
			</div>
		</section>
	);
}
