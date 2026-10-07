# Landing page sources

Interactive product scenes are built from real Web components in
`clients/web/scripts/website-capture`. The checked-in `public/product-demo`
artifact is refreshed explicitly; normal Website builds do not build or import
Web. It contains fictional Atlas sample data, not customer data or live agent
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
