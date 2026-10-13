# Landing page sources

The capability comparison's row definitions, reviewed date, and first-party
evidence live in [comparison-sources.md](comparison-sources.md). Research notes
are not rendered in the public comparison section.

Hero logo placement and pointer parallax were informed by https://t3.codes/.
Layered product scenes, peripheral fades, and detail disclosure were
informed by https://linear.app/homepage and the owner's Linear recordings.
The hero's line-by-line blur, opacity, and small vertical reveal follow the
observed entrance sequence. OpenMeld uses an authored CSS implementation with
its own content and UI. No Linear source, screenshot, or customer content is
included in the site. Product scenes
render OpenMeld's actual components as DOM with fictional team data. Selected
showcase roots are inert; screenshots are used only as validation evidence.
The GitHub CTA wording was requested by the product owner. No T3 source was copied.
The channel selector and expandable-thread composition were informed by
https://www.gumloop.com/home. These are authored, fictional conversation previews,
not captures of Slack, Lark, or Feishu accounts.

The integration logo wall was informed by https://www.openhands.dev/ and the
owner's recording. It uses shared SVG logos and available entries from the
public Plugins catalog, with one tile per brand and every connection in the
details Sheet. No OpenHands source or logo assets were copied. CSS transforms
move two staggered rows; the control pauses them, hidden/offscreen views stop
them, and reduced motion shows a complete static grid.

The Web badge uses `metal-fx@2.0.11` from https://libraries.dev/metal.
It loads after hydration with a static text fallback. Reduced motion omits the
shader; unsupported WebGL retains the plain child. Hero parallax uses shared
agent logos and Motion springs, with no idle animation loop.

Demo blending uses static CSS alpha masks. Linear's public feature stages were
inspected and captured at 1440px on 2026-10-08: Intake fades the background board
through 28% of its right side and 50% of its height; Planning fades 40% of its
right side and 47% of its bottom; AI fades 30% of both sides and 48% of its bottom;
Build fades 44% of its right side and 51% of its bottom. OpenMeld adapts those
relative areas to its own content: layered scenes keep some top/left frame edges,
and Agent/Center Agent/Usage use directional fades that protect the primary
heading. Codex fades its full frame, with a narrower left area to retain its
brand and a broad right/bottom falloff. The implementation uses static alpha
ramps instead of large-area blur filters. These profiles remain unchanged during
focus, filters, playback, navigation, and refresh. The hero has no permanent
mask: its temporary edge veil fades away as the App appears. It animates opacity
instead of blurring a large live iframe. No decorative WebGL loop runs over a
demo. Reduced motion uses a short hero fade without blur or translation.
Linear's inspected public hero code uses one-second text reveals with
`cubic-bezier(.25,.1,.25,1)`, 400/500/600ms title/copy delays, 10px initial blur,
and 20% initial translation. Its App opacity reveal starts at 1300ms, lasts
1500ms, and uses `cubic-bezier(.455,.03,.515,.955)`. OpenMeld reuses that timing,
with its own content and artwork. The shared avatar renderer supplies a visible
poster before hydration and does not run an idle preview loop in the hero.

The computer card structure adapts Animata Bento Grid Three, found in the
owner's Raindrop collection:
https://github.com/codse/animata/blob/main/animata/bento-grid/three.tsx.
The illustration and contents are OpenMeld-specific. Finite SVG motion has a
reduced-motion variant. The 1 vCPU / 6 GiB / 12 GB configuration follows
`services/remote-agent/wrangler.jsonc` (`standard-2`) and
https://developers.cloudflare.com/containers/platform/limits/ (checked 2026-10-07).
Python, Node.js, Git, and FFmpeg follow the checked-in remote-agent Dockerfile.
These are configured specifications, not a benchmark or uptime guarantee.

## Animata license

MIT License

Copyright (c) Animata

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## Product reuse

Interactive product scenes are built from real Web components in
`clients/web/scripts/website-capture`. The checked-in `public/product-demo`
artifact is refreshed explicitly; normal Website builds do not build or import
Web. It contains fictional team sample data, not customer data or live agent
results. See the capture directory README for provenance, boundaries, and the
refresh command. Product shell assembly and selected headers are composed in
the harness; the directory, editor, messages, files, Skills, and Routine controls
use product components.

Center Agent uses the product avatar editor, hosted model selector, and
configuration cards with memory-only choices. Usage composes the actual App
cost and Local Agent token cards, charts, scope tabs, accordions, and detail
tables. Its fictional numeric records follow the shared usage schema; no
customer billing or private activity is embedded.

Navigation and feature disclosure hover use the shared Fluid Hover hook and
highlight from `@openmeld/ui`. Links retain native focus and activation;
clicking a gap does not navigate. FAQ behavior uses the shared Fluid Accordion.

The FAQ's two-column layout is adapted from Tailark Mist FAQs 2:
https://tailark.com/blocks/mist/faqs. The author was discovered through the
Tailark Hero Section 5 entry on 21st.dev. The public free source was inspected
in the browser. No generated component credits or paid components were used.
Copy, colors, spacing, and primitives were adapted for OpenMeld.

Upstream repository: https://github.com/tailark/blocks

## Tailark license

MIT License

Copyright (c) 2025 Irung

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
