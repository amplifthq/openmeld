import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { brandDirectory, findChrome, repositoryRoot } from "./brand-assets.mjs";

const output = join(repositoryRoot, "dev-tmp/brand-review");
mkdirSync(output, { recursive: true });
const picture = (name, width, alt = "OpenMeld") => {
  const retinaName = name.endsWith("-16.png")
    ? name.replace("-16.png", "-32.png")
    : name.replace("-18.png", "-36.png");
  const retina =
    retinaName !== name
      ? ` srcset="${pathToFileURL(join(brandDirectory, retinaName)).href} 2x"`
      : "";
  return `<img alt="${alt}" src="${pathToFileURL(join(brandDirectory, name)).href}"${retina} width="${width}">`;
};
const styles =
  "*{box-sizing:border-box}body{margin:0;padding:40px;background:#151515;color:#eee;font:15px -apple-system,BlinkMacSystemFont,sans-serif}h1{font-size:27px;font-weight:550;margin:0 0 8px}h2{font-size:16px;font-weight:500;margin:0 0 18px}p{margin:0;color:#aaa;line-height:1.5}.grid{display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-top:26px}.card{border:1px solid #333;border-radius:14px;padding:22px;overflow:hidden}.light{background:#eee;color:#222;border-color:#ddd}.light p{color:#666}.dark{background:#080808}.row{display:flex;gap:26px;align-items:center;justify-content:center;min-height:170px}img{display:block;max-width:100%;height:auto}.caption{text-align:center;margin-top:14px;font-size:13px;color:#999}.wide{grid-column:1/-1}.word{display:flex;align-items:center;justify-content:center;height:155px}.bar{height:42px;display:flex;gap:16px;align-items:center;padding:0 15px;border-radius:7px;background:#292929}.light .bar{background:#d3d3d3}.bar span{font-size:13px}.tab{display:flex;align-items:center;gap:9px;font-size:13px;height:40px;padding:0 15px;border-radius:7px;background:#303030}.light .tab{background:#fff}.hero{display:flex;justify-content:center}.note{font-size:13px;margin-top:22px}";
const desktop = `<h1>OpenMeld · Desktop & small icons</h1><p>Optical alignment · clean face · upper-middle glow</p><div class="grid">
<div class="card" style="background:#202020"><h2>Desktop · dark background</h2><div class="row">${picture("openmeld-desktop-1024.png", 192)}${picture("openmeld-desktop-64.png", 64)}${picture("openmeld-desktop-32.png", 32)}</div><p class="caption">192 px / 64 px / 32 px</p></div>
<div class="card light"><h2>Desktop · light background</h2><div class="row">${picture("openmeld-desktop-1024.png", 192)}${picture("openmeld-desktop-64.png", 64)}${picture("openmeld-desktop-32.png", 32)}</div><p class="caption">Actual exported tile, including transparent padding</p></div>
<div class="card"><h2>Browser · dark theme</h2><div class="tab">${picture("openmeld-favicon-16.png", 16)}<span>OpenMeld</span></div><div class="row" style="min-height:90px">${picture("openmeld-favicon-16.png", 16)}${picture("openmeld-favicon-32.png", 32)}${picture("openmeld-favicon-48.png", 48)}</div><p>Native-size favicon · 16 / 32 / 48 px</p></div>
<div class="card light"><h2>Browser · light theme</h2><div class="tab">${picture("openmeld-favicon-16.png", 16)}<span>OpenMeld</span></div><div class="row" style="min-height:90px">${picture("openmeld-favicon-16.png", 16)}${picture("openmeld-favicon-32.png", 32)}${picture("openmeld-favicon-48.png", 48)}</div><p>The same favicon stays visible in both themes.</p></div>
<div class="card"><h2>Menu bar · dark</h2><div class="bar"><span>OpenMeld</span><span style="flex:1"></span>${picture("openmeld-letter-o-mono-white-18.png", 18)}<span>100%</span><span>10:08</span></div></div>
<div class="card light"><h2>Menu bar · light</h2><div class="bar"><span>OpenMeld</span><span style="flex:1"></span>${picture("openmeld-letter-o-mono-black-18.png", 18)}<span>100%</span><span>10:08</span></div></div></div><p class="note">Asset previews. Native OS masking, menu-bar inversion, and installed-app rendering require release smoke.</p>`;
const brand = `<h1>OpenMeld · Official brand set</h1><p>Single letter, full wordmark, transparent artwork, and social sharing</p><div class="grid">
<div class="card dark"><h2>Single letter · dark</h2><div class="hero">${picture("openmeld-letter-o-glow-1024.png", 280)}</div></div>
<div class="card light"><h2>Single letter · light</h2><div class="hero">${picture("openmeld-letter-o-ink-1024.png", 280)}</div></div>
<div class="card dark"><h2>Wordmark · dark</h2><div class="word">${picture("openmeld-wordmark-glow-2400.png", 460)}</div></div>
<div class="card light"><h2>Wordmark · light</h2><div class="word">${picture("openmeld-wordmark-ink-2400.png", 460)}</div></div>
<div class="card" style="background:#163a43"><h2>Transparent · on color</h2><div class="word">${picture("openmeld-wordmark-glow-2400.png", 460)}</div></div>
<div class="card light" style="background:#e5dece"><h2>Transparent · on a warm surface</h2><div class="word">${picture("openmeld-wordmark-ink-2400.png", 460)}</div></div>
<div class="card"><h2>Social card · 1200 × 630</h2>${picture("openmeld-social-1200x630.png", 460)}</div>
<div class="card"><h2>Monochrome · documents & small marks</h2><div class="row">${picture("openmeld-letter-o-mono-white-128.png", 128)}<div style="background:#eee;border-radius:8px">${picture("openmeld-letter-o-mono-black-128.png", 128)}</div></div><p>No glow or fine outline. Use for a single-color output.</p></div></div>`;
for (const [name, content, height] of [
  ["desktop", desktop, 920],
  ["brand", brand, 1410],
]) {
  const page = join(output, `${name}.html`);
  writeFileSync(
    page,
    `<!doctype html><html lang="en"><meta charset="utf-8"><title>OpenMeld brand review</title><style>${styles}</style><body>${content}</body></html>`
  );
  execFileSync(
    findChrome(),
    [
      "--headless=new",
      "--disable-gpu",
      "--hide-scrollbars",
      "--force-device-scale-factor=2",
      "--virtual-time-budget=1000",
      `--window-size=1100,${height}`,
      `--screenshot=${join(output, `${name}.png`)}`,
      pathToFileURL(page).href,
    ],
    { stdio: "pipe" }
  );
}
console.log(`Saved brand previews to ${output}`);
