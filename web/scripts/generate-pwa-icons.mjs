// Renders the app icons used by the PWA manifest from the logo mark (src/components/app/logo.tsx).
// sharp ships with Next.js but is not a direct dependency, so point Node at it:
//   NODE_PATH=$(echo node_modules/.pnpm/sharp@*/node_modules) node scripts/generate-pwa-icons.mjs
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const sharp = require("sharp");

const BG = "#262626"; // --primary (neutral-800)
const FG = "#fafafa"; // --primary-foreground (neutral-50)
const arrows = `
  <path d="M9 12.5h11.5l-3-3" stroke="${FG}" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M23 19.5H11.5l3 3" stroke="${FG}" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round" opacity=".7"/>`;

// "any": rounded tile like the in-app logo. "maskable": full-bleed square, arrows shrunk into the safe zone.
const anySvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="${BG}"/>${arrows}</svg>`;
const maskableSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" fill="${BG}"/><g transform="translate(16 16) scale(0.72) translate(-16 -16)">${arrows}</g></svg>`;
// Apple ignores transparency and rounds corners itself, so give it a full square.
const appleSvg = maskableSvg.replace("scale(0.72)", "scale(0.85)");

const out = path.resolve("public/icons");
mkdirSync(out, { recursive: true });
const jobs = [
  [anySvg, 192, "icon-192.png"],
  [anySvg, 512, "icon-512.png"],
  [maskableSvg, 192, "maskable-192.png"],
  [maskableSvg, 512, "maskable-512.png"],
  [appleSvg, 180, "apple-touch-icon.png"],
];
for (const [svg, size, name] of jobs) {
  await sharp(Buffer.from(svg), { density: 72 * (size / 32) }).resize(size, size).png().toFile(path.join(out, name));
  console.log("wrote", name);
}
