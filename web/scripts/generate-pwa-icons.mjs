// Renders the app icons (PWA manifest, favicon, apple-touch) and the brand assets in ../assets/brand
// from the coin-with-SIM-hole mark (keep in sync with src/components/app/logo.tsx and the Android ic_agent.xml).
// sharp ships with Next.js but is not a direct dependency, so point Node at it:
//   NODE_PATH=$(echo node_modules/.pnpm/sharp@*/node_modules) node scripts/generate-pwa-icons.mjs
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const sharp = require("sharp");

const GREEN = "#0f6e56";
const GOLD = "#e3a93b";
const RING = "#ca922b";
const DARK = "#0e2a22";
const CREAM = "#f5f2ea";

// Geometry is centred on 0,0 in units where the app-icon tile is 120 wide.
// The coin with the rotated SIM cut out (even-odd), so the hole shows whatever is behind it.
const COIN = "M0-39.6a39.6 39.6 0 1 1 0 79.2a39.6 39.6 0 1 1 0-79.2Z";
const SIM =
  "M-16.66-10.72A3 3 0 0 1-14.35-14.28L0.12-17.36A3 3 0 0 1 2.38-16.94L10.33-11.78A3 3 0 0 1 11.63-9.89L16.26 11.92A3 3 0 0 1 13.95 15.48L-7.08 19.95A3 3 0 0 1-10.63 17.64Z";
const ringPath = (color) => `<circle r="34.1" fill="none" stroke="${color}" stroke-width="1.6"/>`;
const coin = (ring = RING) => `<path d="${COIN}${SIM}" fill="${GOLD}" fill-rule="evenodd"/>${ringPath(ring)}`;

const markSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-40 -40 80 80">${coin()}</svg>`;
const monoSvg = (color) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-40 -40 80 80"><path d="${COIN}${SIM}" fill="${color}" fill-rule="evenodd"/></svg>`;

// "any": rounded tile. "maskable": full-bleed square with the coin inside the safe zone.
const tileSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-60 -60 120 120"><rect x="-60" y="-60" width="120" height="120" rx="25" fill="${GREEN}"/>${coin()}</svg>`;
const squareSvg = (scale) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-60 -60 120 120"><rect x="-60" y="-60" width="120" height="120" fill="${GREEN}"/><g transform="scale(${scale})">${coin()}</g></svg>`;
const maskableSvg = squareSvg(1);
// Apple ignores transparency and rounds corners itself, so give it a full square.
const appleSvg = squareSvg(1.05);

const render = (svg, size) => sharp(Buffer.from(svg), { density: 72 * (size / 80) * 4 }).resize(size, size).png().toBuffer();

const out = path.resolve("public/icons");
mkdirSync(out, { recursive: true });
const jobs = [
  [tileSvg, 192, "icon-192.png"],
  [tileSvg, 512, "icon-512.png"],
  [maskableSvg, 192, "maskable-192.png"],
  [maskableSvg, 512, "maskable-512.png"],
  [appleSvg, 180, "apple-touch-icon.png"],
];
for (const [svg, size, name] of jobs) {
  writeFileSync(path.join(out, name), await render(svg, size));
  console.log("wrote", name);
}

// favicon.ico with PNG-encoded entries (supported by every current browser).
const icoSizes = [16, 32, 48];
const pngs = await Promise.all(icoSizes.map((s) => render(tileSvg, s)));
const header = Buffer.alloc(6 + 16 * pngs.length);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(pngs.length, 4);
let offset = header.length;
pngs.forEach((png, i) => {
  const e = 6 + 16 * i;
  header.writeUInt8(icoSizes[i], e);
  header.writeUInt8(icoSizes[i], e + 1);
  header.writeUInt16LE(1, e + 4);
  header.writeUInt16LE(32, e + 6);
  header.writeUInt32LE(png.length, e + 8);
  header.writeUInt32LE(offset, e + 12);
  offset += png.length;
});
writeFileSync(path.resolve("src/app/favicon.ico"), Buffer.concat([header, ...pngs]));
console.log("wrote favicon.ico");

const brandOut = path.resolve("../assets/brand");
mkdirSync(brandOut, { recursive: true });
const assets = {
  "mark.svg": markSvg,
  "mark-mono-dark.svg": monoSvg(DARK),
  "mark-mono-light.svg": monoSvg(CREAM),
  "app-icon.svg": tileSvg,
  "app-icon-maskable.svg": maskableSvg,
};
for (const [name, svg] of Object.entries(assets)) writeFileSync(path.join(brandOut, name), svg + "\n");
writeFileSync(path.resolve("../assets/icon.svg"), tileSvg + "\n");
for (const size of [1024, 512, 180, 96, 48]) {
  writeFileSync(path.join(brandOut, `app-icon-${size}.png`), await render(tileSvg, size));
  writeFileSync(path.join(brandOut, `mark-${size}.png`), await render(markSvg, size));
}
console.log("wrote brand assets to", brandOut);
