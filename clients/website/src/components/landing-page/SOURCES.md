# Landing page sources

Hero logo placement and pointer parallax were informed by https://t3.codes/.
The GitHub CTA wording was requested by the product owner. No T3 source was copied.
The channel selector and expandable-thread composition were informed by
https://www.gumloop.com/home. These are authored, fictional conversation previews,
not captures of Slack, Lark, or Feishu accounts.

The Web badge uses `metal-fx@2.0.11` from https://libraries.dev/metal.
It loads after hydration with a static text fallback. Reduced motion omits the
shader; unsupported WebGL retains the plain child. Hero parallax uses shared
agent logos and Motion springs, with no idle animation loop.

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
Web. It contains fictional Amplift sample data, not customer data or live agent
results. See the capture directory README for provenance, boundaries, and the
refresh command. Product shell assembly and selected headers are composed in
the harness; the directory, editor, messages, files, Skills, and Routine controls
use product components.

Navigation and agent-directory hover use the shared Fluid Hover hook and
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
