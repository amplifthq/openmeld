# Third-party notices

## Fluid Functionalism

OpenMeld adapts registry components and shared interaction utilities from
[Fluid Functionalism](https://github.com/mickadesign/fluid-functionalism)
by Micka Touillaud. Adaptations include components under `src/fluid/`, Fluid
Hover in `src/hooks/use-fluid-hover.ts`, and supporting shared style and motion
utilities. OpenMeld adjusts these for its design tokens, icons, and product
behavior. This notice applies to the upstream portions, not every file in those
directories.

Registry source examples:
[Tabs](https://www.fluidfunctionalism.com/r/base/tabs.json),
[Sidebar](https://www.fluidfunctionalism.com/r/base/sidebar.json),
[Dialog](https://www.fluidfunctionalism.com/r/base/dialog.json), and
[Fluid Hover](https://www.fluidfunctionalism.com/r/use-fluid-hover.json).

The complete [MIT license](licenses/fluid-functionalism.MIT.txt) is copied
verbatim from [upstream revision 3fd7be89](https://github.com/mickadesign/fluid-functionalism/blob/3fd7be89abd00f171aa92434c51e18fee43993e4/LICENSE),
checked October 13, 2026. That revision identifies the license text, not the
import revision of every component. Preserve this notice and the license when
distributing the adapted code.

## AICSS Approval Card

`src/components/approval-card.tsx` adapts the Approval Card installed from
https://www.aicss.dev/r/approval-card.json on September 10, 2026.
The card anatomy uses OpenMeld tokens and scrolling primitives; demo content,
automatic approval, download controls, and animation timers were removed.

MIT License

Copyright (c) 2026 AICSS

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

## Motion Primitives Dock

The cursor-proximity magnification in `src/components/magnifying-dock.tsx` is
adapted from the Motion Primitives Dock component.

MIT License

Copyright (c) 2024 ibelick

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies
of the Software, and to permit persons to whom the Software is furnished to do
so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
