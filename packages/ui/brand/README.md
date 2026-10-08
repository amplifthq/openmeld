# OpenMeld brand assets

## Ownership

- `src/lib/openmeld-logo-lines.ts` owns the ASCII geometry shared by the
  interactive UI logo and the static exporter. Keep one copy of these grids.
- `scripts/brand-renderer.mjs` owns static composition: masked decorative
  strokes, the frozen upper-middle glow, optical alignment, and the wider
  monochrome side projections.
- `scripts/brand-assets.mjs` runs the renderer in Chromium and provides native
  icon packing helpers.
- `public/brand/` is the only checked-in set of exported brand images.
  Do not keep a second PNG master or crop assets separately in clients.
- Client export scripts preserve existing Web and Desktop resource filenames.
  Vite's existing shared-public step copies the Web assets into Website, App,
  and Docs artifacts. Desktop packages its native resources separately.

## Generate and inspect

Run from the repository root:

```sh
pnpm brand:generate
pnpm brand:preview
```

Generation uses Node 24, macOS Menlo, Chrome/Chromium, sips, and iconutil.
`CHROME_PATH` can select Chromium. No running app, account, or network request
is needed. Builds consume checked-in images; they do not need the renderer or
its generation environment. `brand:preview` creates review sheets in the ignored
`dev-tmp/brand-review/` directory; historical experiments are not build inputs.

## Approved treatments

| Surface | Treatment |
| --- | --- |
| Browser tab | Wider monochrome O on a dark square, with native 16/32/48px ICO layers |
| macOS menu bar | Wider monochrome O, black on transparent; AppKit owns inversion |
| Desktop app | Full outlined O and subtle glow on a rounded dark tile |
| Large brand and metadata image | Full outlined O and subtle glow |
| Full wordmark | White glow for dark backgrounds; dark ink for light backgrounds |
| Single-color documents | Monochrome O without outline or glow |

Transparent white assets are for dark backgrounds; use the ink variant for light
backgrounds. The monochrome side projections are widened by one quarter of a
cell on each side. Inner opening and top/bottom bars are unchanged. Full artwork
retains 92% of the complete-outline horizontal centering correction. This places
the bright face slightly right of equal outer margins. Vertically it
retains 40% of the complete-outline centering correction to preserve the approved
balance. Monochrome marks remain centered on their symmetric silhouette.

## Reuse

The public files remain at `/brand/<filename>`. Existing
`openmeld-letter-o-glow-*.png` and `openmeld-letter-o-glow-black-*.jpg` names
remain compatible with metadata and third-party links.

Additional exports include:

- `openmeld-wordmark-{glow,ink,dark,light}-2400.png`
- `openmeld-letter-o-{ink,dark,light}-1024.png`
- `openmeld-letter-o-mono-{white,black}-{size}.png`
- `openmeld-social-1200x630.png`

Third-party OAuth applications use the opaque
`openmeld-letter-o-dark-1024.png` export. PostHog's client metadata at
`clients/website/public/.well-known/posthog-client.json` points to that asset
on the Website. Keep these application logos independent of browser favicon
and menu-bar treatments.

Existing `favicon.ico`, `favicon-16x16.png`, `favicon-32x32.png`,
`apple-touch-icon.png`, `icon-192.png`, and `icon-512.png` stay at their old
paths. Desktop retains `resources/icon.png`, `resources/icon.icns`, and
`resources/tray-icon.png`. Windows packaging derives its icon from the existing
PNG input. Shared favicon URL versioning refreshes the Website, App, and Docs
head links without changing public filenames.

Each client still requires its own build and release. Merely merging this change
does not update installed apps, deployed sites, or third-party image caches.
Native installed-app acceptance belongs to the Desktop release. Static review
sheets do not claim to reproduce AppKit or browser chrome exactly.
