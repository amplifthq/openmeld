import { execFileSync } from "node:child_process";
import {
	copyFileSync,
	existsSync,
	mkdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

// The generated glow render (openmeld-logo-core.tsx letter-O / strong, captured
// via headless Chrome). Single source of truth for every LARGE icon size.
export const MASTER_PATH = resolve(
	here,
	"logo-source/openmeld-logo-master.png"
);

// OpenMeld letter-O box-drawing grid (mirrors OPENMELD_LETTER_O_LOGO_LINES in
// packages/ui/src/components/openmeld-logo-core.tsx). Used to render the SIMPLE
// variant for tiny sizes where the glow would just smear into grey.
export const OPENMELD_LETTER_O_LINES = [
	" ██████╗",
	"██╔═══██╗",
	"██║   ██║",
	"██║   ██║",
	"╚██████╔╝",
	" ╚═════╝ ",
];

const FILL_CHAR = "█";
const STRONG_INFLUENCE_RANGE = 0.34;
const STRONG_GLOW_BLUR_PX = 11;
const STRONG_GLOW_MAX_OPACITY = 0.85;
const STRONG_BASE_OPACITY = 0.4;
const STRONG_FILL_MIN_OPACITY = 0.62;
const STRONG_STROKE_BRIGHTNESS = 0.42;

const CHROME_CANDIDATES = [
	"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
	"/Applications/Chromium.app/Contents/MacOS/Chromium",
	"/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
];

export function findChrome() {
	const fromEnv = process.env.CHROME_PATH;
	if (fromEnv && existsSync(fromEnv)) {
		return fromEnv;
	}
	for (const candidate of CHROME_CANDIDATES) {
		if (existsSync(candidate)) {
			return candidate;
		}
	}
	throw new Error(
		"No Chromium-based browser found. Set CHROME_PATH to render icons."
	);
}

function pngSize(path) {
	const buffer = readFileSync(path);
	return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

let cachedSquareMaster = null;

// Center-crop the master to a perfect square (no distortion) once, reuse it.
function ensureSquareMaster() {
	if (cachedSquareMaster && existsSync(cachedSquareMaster)) {
		return cachedSquareMaster;
	}
	const { width, height } = pngSize(MASTER_PATH);
	const side = Math.min(width, height);
	const out = join(tmpdir(), "openmeld-logo-master-square.png");
	execFileSync(
		"sips",
		["-c", String(side), String(side), MASTER_PATH, "--out", out],
		{
			stdio: "pipe",
		}
	);
	cachedSquareMaster = out;
	return out;
}

// LARGE sizes: faithful downscale of the master (preserves the padded,
// glow-with-breathing-room composition).
export function renderMasterPng(size, outPath) {
	const square = ensureSquareMaster();
	mkdirSync(dirname(outPath), { recursive: true });
	execFileSync(
		"sips",
		["-z", String(size), String(size), square, "--out", outPath],
		{
			stdio: "pipe",
		}
	);
	return outPath;
}

// LARGE sizes with ENLARGED framing: scale the O (+ glow) up to a bigger
// fraction of the canvas via CSS background, centered. Used for the desktop app
// icon, where the padded master composition reads too small in the dock.
function composedHtml({ size, scale, posy, master }) {
	const cfg = JSON.stringify({ size, scale, posy, master });
	return `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;padding:0}
#stage{background-repeat:no-repeat;background-color:#000000}
</style></head><body><div id="stage"></div>
<script>
const C=${cfg};
const s=document.getElementById("stage");
s.style.width=C.size+"px";s.style.height=C.size+"px";
s.style.backgroundImage='url("'+C.master+'")';
s.style.backgroundSize=C.scale+"%";
s.style.backgroundPosition="50% "+C.posy+"%";
document.title="composed";
</script></body></html>`;
}

export function renderMasterComposedPng(
	size,
	outPath,
	{ scale = 170, posy = 52 } = {}
) {
	const html = composedHtml({
		size,
		scale,
		posy,
		master: `file://${MASTER_PATH}`,
	});
	const htmlPath = join(
		tmpdir(),
		`openmeld-composed-${size}-${process.pid}.html`
	);
	writeFileSync(htmlPath, html);
	mkdirSync(dirname(outPath), { recursive: true });
	const chrome = findChrome();
	execFileSync(
		chrome,
		[
			"--headless=new",
			"--disable-gpu",
			"--hide-scrollbars",
			"--force-device-scale-factor=1",
			"--allow-file-access-from-files",
			"--default-background-color=000000ff",
			`--window-size=${size},${size}`,
			`--screenshot=${outPath}`,
			`file://${htmlPath}`,
		],
		{ stdio: "pipe" }
	);
	rmSync(htmlPath, { force: true });
	return outPath;
}

function strongHtml({ size, content, color, bg }) {
	const cfg = JSON.stringify({
		size,
		content,
		color,
		bg,
		lines: OPENMELD_LETTER_O_LINES,
	});
	return `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;padding:0}
#stage{display:flex;align-items:center;justify-content:center;overflow:hidden}
.logo{position:relative;white-space:pre;line-height:1;letter-spacing:0;font-family:"SF Mono",SFMono-Regular,Menlo,Monaco,Consolas,"Liberation Mono","Courier New",monospace}
.logo pre{margin:0}.logo .layer{position:absolute;top:0;left:0}.logo span{display:block}
</style></head><body><div id="stage"><div class="logo" id="logo"></div></div>
<script>
const C=${cfg};
const FILL=${JSON.stringify(FILL_CHAR)};
const ROWS=C.lines.length;
const fontSize=C.size*C.content/ROWS;
const stage=document.getElementById("stage");
stage.style.width=C.size+"px";stage.style.height=C.size+"px";
stage.style.background=C.bg;
const logo=document.getElementById("logo");
logo.style.fontSize=fontSize+"px";logo.style.color=C.color;
const fillLine=(l)=>[...l].map((c)=>c===FILL?c:" ").join("");
const strokeLine=(l)=>[...l].map((c)=>c===FILL?" ":c).join("");
const influenceForRow=(i)=>Math.max(0,1-Math.abs(((i+0.5)/ROWS)-0.5)/${STRONG_INFLUENCE_RANGE});
function layer(lineFn,absolute,z,styleFn){const pre=document.createElement("pre");if(absolute){pre.className="layer";}pre.style.zIndex=String(z);if(styleFn){Object.assign(pre.style,styleFn(-1));}C.lines.forEach((l,i)=>{const s=document.createElement("span");s.textContent=lineFn(l);if(styleFn){Object.assign(s.style,styleFn(i));}pre.appendChild(s);});logo.appendChild(pre);}
layer(fillLine,true,0,(i)=>i<0?{filter:"blur(${STRONG_GLOW_BLUR_PX}px)"}:{opacity:String(influenceForRow(i)*${STRONG_GLOW_MAX_OPACITY})});
layer(fillLine,true,1,()=>({opacity:String(${STRONG_BASE_OPACITY})}));
layer(strokeLine,true,2,(i)=>i<0?{filter:"brightness(${STRONG_STROKE_BRIGHTNESS})"}:{});
layer(fillLine,false,3,(i)=>({opacity:String(${STRONG_FILL_MIN_OPACITY}+influenceForRow(i)*(1-${STRONG_FILL_MIN_OPACITY}))}));
document.title="rendered";
</script></body></html>`;
}

export function renderStrongLogoPng(
	size,
	outPath,
	{ content = 0.36, color = "#ffffff", bg = "#000000" } = {}
) {
	const html = strongHtml({ size, content, color, bg });
	const htmlPath = join(
		tmpdir(),
		`openmeld-strong-${size}-${process.pid}.html`
	);
	writeFileSync(htmlPath, html);
	mkdirSync(dirname(outPath), { recursive: true });
	const chrome = findChrome();
	execFileSync(
		chrome,
		[
			"--headless=new",
			"--disable-gpu",
			"--hide-scrollbars",
			"--force-device-scale-factor=1",
			"--allow-file-access-from-files",
			"--default-background-color=000000ff",
			`--window-size=${size},${size}`,
			`--screenshot=${outPath}`,
			`file://${htmlPath}`,
		],
		{ stdio: "pipe" }
	);
	rmSync(htmlPath, { force: true });
	return outPath;
}

function simpleHtml({ size, content, color, bg }) {
	const cfg = JSON.stringify({
		size,
		content,
		color,
		bg,
		lines: OPENMELD_LETTER_O_LINES,
	});
	return `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;padding:0}
#stage{display:flex;align-items:center;justify-content:center;overflow:hidden}
.logo{position:relative;white-space:pre;line-height:1;letter-spacing:0;font-family:"SF Mono",SFMono-Regular,Menlo,Monaco,Consolas,"Liberation Mono","Courier New",monospace}
.logo pre{margin:0}.logo .layer{position:absolute;top:0;left:0}.logo span{display:block}
</style></head><body><div id="stage"><div class="logo" id="logo"></div></div>
<script>
const C=${cfg};
const FILL=${JSON.stringify(FILL_CHAR)};
const ROWS=C.lines.length;
const fontSize=C.size*C.content/ROWS;
const stage=document.getElementById("stage");
stage.style.width=C.size+"px";stage.style.height=C.size+"px";
stage.style.background=C.bg==="transparent"?"transparent":(C.bg==="dark"?"#050607":"#000000");
const logo=document.getElementById("logo");
logo.style.fontSize=fontSize+"px";logo.style.color=C.color;
const fillLine=(l)=>[...l].map((c)=>c===FILL?c:" ").join("");
const strokeLine=(l)=>[...l].map((c)=>c===FILL?" ":c).join("");
function layer(lineFn,absolute,z){const pre=document.createElement("pre");if(absolute){pre.className="layer";}pre.style.zIndex=String(z);C.lines.forEach((l)=>{const s=document.createElement("span");s.textContent=lineFn(l);pre.appendChild(s);});logo.appendChild(pre);}
layer(strokeLine,true,1);
layer(fillLine,false,2);
document.title="rendered";
</script></body></html>`;
}

// SMALL sizes: solid legible O (no glow, no dimmed stroke). color/bg let the
// tray render a black-on-transparent template image.
export function renderSimplePng(
	size,
	outPath,
	{ content = 0.82, color = "#ffffff", bg = "black" } = {}
) {
	const html = simpleHtml({ size, content, color, bg });
	const htmlPath = join(
		tmpdir(),
		`openmeld-simple-${size}-${process.pid}.html`
	);
	writeFileSync(htmlPath, html);
	mkdirSync(dirname(outPath), { recursive: true });
	const chrome = findChrome();
	execFileSync(
		chrome,
		[
			"--headless=new",
			"--disable-gpu",
			"--hide-scrollbars",
			"--force-device-scale-factor=1",
			"--default-background-color=00000000",
			`--window-size=${size},${size}`,
			`--screenshot=${outPath}`,
			`file://${htmlPath}`,
		],
		{ stdio: "pipe" }
	);
	rmSync(htmlPath, { force: true });
	return outPath;
}

// Pack PNGs into a multi-size .ico (Vista+ PNG-in-ICO; no deps).
export function buildIco(entries, outPath) {
	const pngs = entries.map((entry) => ({
		size: entry.size,
		data: readFileSync(entry.path),
	}));
	const header = Buffer.alloc(6);
	header.writeUInt16LE(0, 0);
	header.writeUInt16LE(1, 2);
	header.writeUInt16LE(pngs.length, 4);
	const directory = [];
	let offset = 6 + pngs.length * 16;
	for (const png of pngs) {
		const entry = Buffer.alloc(16);
		const dim = png.size >= 256 ? 0 : png.size;
		entry.writeUInt8(dim, 0);
		entry.writeUInt8(dim, 1);
		entry.writeUInt8(0, 2);
		entry.writeUInt8(0, 3);
		entry.writeUInt16LE(1, 4);
		entry.writeUInt16LE(32, 6);
		entry.writeUInt32LE(png.data.length, 8);
		entry.writeUInt32LE(offset, 12);
		offset += png.data.length;
		directory.push(entry);
	}
	writeFileSync(
		outPath,
		Buffer.concat([header, ...directory, ...pngs.map((p) => p.data)])
	);
	return outPath;
}

// Build a macOS .icns from an iconset map { "icon_16x16.png": pngPath, ... }.
export function buildIcns(iconset, outPath) {
	const iconsetDir = join(tmpdir(), `openmeld-${process.pid}.iconset`);
	rmSync(iconsetDir, { force: true, recursive: true });
	mkdirSync(iconsetDir, { recursive: true });
	for (const [filename, path] of Object.entries(iconset)) {
		copyFileSync(path, join(iconsetDir, filename));
	}
	rmSync(outPath, { force: true });
	execFileSync("iconutil", ["-c", "icns", iconsetDir, "-o", outPath], {
		stdio: "pipe",
	});
	rmSync(iconsetDir, { force: true, recursive: true });
	return outPath;
}
