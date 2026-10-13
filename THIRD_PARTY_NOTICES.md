# Third-party notices

OpenMeld's original code uses the root [MIT License](LICENSE).
That license does not replace licenses or notices attached to third-party material.

This index points to notices kept with copied code and assets.
It is not a complete dependency inventory or a claim that every dependency uses MIT.
Package dependencies retain their own licenses in their distributions.
For acknowledgments of major upstream projects, see [Credits](CREDITS.md).
For all external packages declared in tracked manifests, see the
[direct dependency index](docs/dependencies.md). This includes Libraries.dev
packages such as `border-beam`, and Better Auth with its plugins.
Their installed package distributions carry their own notices.

## Copied code and assets

| Material | Location and notice |
| --- | --- |
| Fluid Functionalism components and shared interaction utilities, by Micka Touillaud | [UI source notice](packages/ui/THIRD_PARTY_NOTICES.md#fluid-functionalism), [MIT license](packages/ui/licenses/fluid-functionalism.MIT.txt) |
| AICSS Approval Card and Motion Primitives Dock, Text Morph, and Morphing Dialog adaptations | [UI notices](packages/ui/THIRD_PARTY_NOTICES.md) |
| Rare UI folder artwork and primitive, by Swami Malode | [Component license](packages/ui/src/components/folder-component.LICENSE.md) |
| Rare UI Fluid Orb shader, by Swami Malode | [UI source notice](packages/ui/THIRD_PARTY_NOTICES.md#rare-ui-fluid-orb) |
| Skiper UI progressive blur adaptation | [Source attribution](packages/ui/src/components/progressive-blur.tsx) to [Skiper UI](https://skiper-ui.com/) |
| Evil Charts components | [License](packages/ui/src/components/evilcharts/LICENSE) |
| Extend components, including shadcn portions | [License](clients/web/src/components/extend/LICENSE.md) |
| Geist, Geist Mono, and Geist Pixel fonts | [Font notices](packages/ui/public/fonts/README.md) |
| Emoji data | [License](clients/web/public/emoji/17.0.0/LICENSE) |
| Lark protocol code | [License](services/core/src/remote-agent/transport/lark/protocol/LICENSE) |
| Hairline website effect | [Notice](clients/website/public/third-party-notices/hairline.txt) |
| Animata and Tailark website adaptations | [Website sources and licenses](clients/website/src/components/landing-page/SOURCES.md) |
| Fictional demo profile portraits | [Photo sources and terms](clients/web/scripts/website-capture/avatars/SOURCES.md) |
| PostHog test and debugging skills | [Writing tests](.agents/skills/writing-tests/LICENSE), [CI debugging](.agents/skills/debugging-ci-failures/LICENSE), [flaky tests](.agents/skills/fixing-flaky-tests/LICENSE) |
| Contributor Covenant | [Code of Conduct attribution](CODE_OF_CONDUCT.md#attribution) |

## Rare UI terms

The folder component is adapted from [Rare UI](https://rareui.com).
Its notice is **MIT + Commons Clause License Condition v1.0 + Attribution**,
which adds restrictions beyond the root MIT license.

Read the component's full notice before distributing that material.
Keep its copyright, license, and visible Rare UI attribution.
The root license does not remove its restrictions on selling, sublicensing,
or redistributing the components themselves.

## Adding third-party material

Keep the source URL, copyright notice, required license text, and attribution
with the material. Add an entry here.
Preserve existing notices when moving or adapting code.

A link in this index does not replace a license text that must accompany a distribution.
Check the notices for the actual files and dependencies you distribute.
