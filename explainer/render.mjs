// Render index.html frame-by-frame with headless Chromium, then mux with audio/master.wav.
// Usage: node render.mjs            -> full video to out/sarfli-explainer.mp4
//        node render.mjs --stills   -> one PNG per scene (plus a few mid-scene shots) into out/stills/
import { chromium } from "playwright-core";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FPS = 30;
const stills = process.argv.includes("--stills");
const scenes = JSON.parse(fs.readFileSync(path.join(HERE, "durations.json"), "utf8"));
const last = scenes[scenes.length - 1];
const totalSec = last.start + last.duration;

const chromePath = path.join(os.homedir(), "AppData/Local/ms-playwright/chromium-1248/chrome-win64/chrome.exe");
const ffmpeg = execFileSync("python", ["-c", "import imageio_ffmpeg as f;print(f.get_ffmpeg_exe())"]).toString().trim();

const browser = await chromium.launch({ executablePath: chromePath, headless: true, args: ["--force-device-scale-factor=1", "--font-render-hinting=none"] });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
await page.addInitScript((s) => { window.__scenes = s; }, scenes);
await page.goto(pathToFileURL(path.join(HERE, "index.html")).href);
await page.evaluate(() => document.fonts.ready);
const cdp = await page.context().newCDPSession(page);

async function shot(tMs, file, format = "jpeg") {
  await page.evaluate((t) => window.render(t), tMs);
  const { data } = await cdp.send("Page.captureScreenshot", { format, quality: format === "jpeg" ? 93 : undefined, captureBeyondViewport: false });
  fs.writeFileSync(file, Buffer.from(data, "base64"));
}

if (stills) {
  const dir = path.join(HERE, "out", "stills");
  fs.mkdirSync(dir, { recursive: true });
  for (const s of scenes) {
    for (const frac of [0.35, 0.95]) {
      const t = (s.start + s.duration * frac) * 1000;
      await shot(t, path.join(dir, `${s.id}-${Math.round(frac * 100)}.png`), "png");
    }
  }
  console.log("stills written to", dir);
} else {
  const frames = path.join(HERE, "frames");
  fs.rmSync(frames, { recursive: true, force: true });
  fs.mkdirSync(frames, { recursive: true });
  const n = Math.ceil(totalSec * FPS);
  const t0 = Date.now();
  for (let i = 0; i < n; i++) {
    await shot((i / FPS) * 1000, path.join(frames, `f${String(i).padStart(5, "0")}.jpg`));
    if (i % 300 === 0) console.log(`frame ${i}/${n}  ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  }
  fs.mkdirSync(path.join(HERE, "out"), { recursive: true });
  const out = path.join(HERE, "out", "sarfli-explainer.mp4");
  const r = spawnSync(ffmpeg, [
    "-y", "-loglevel", "error", "-stats",
    "-framerate", String(FPS), "-i", path.join(frames, "f%05d.jpg"),
    "-i", path.join(HERE, "audio", "master.wav"),
    "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p", "-movflags", "+faststart",
    "-c:a", "aac", "-b:a", "192k", "-shortest", out,
  ], { stdio: "inherit" });
  if (r.status !== 0) throw new Error("ffmpeg failed");
  console.log("video written to", out, `(${(fs.statSync(out).size / 1e6).toFixed(1)} MB, ${totalSec.toFixed(1)}s)`);
}
await browser.close();
