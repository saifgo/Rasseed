// Render index.html frame-by-frame with headless Chromium, then mux with audio/master.wav.
// Usage: node render.mjs            -> full video to out/sarfli-explainer.mp4
//        node render.mjs --stills   -> one PNG per scene (plus a few mid-scene shots) into out/stills/
import { chromium } from "playwright-core";
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
// --dir <folder>: render another video from that folder (its index.html, durations.json, audio/)
const dirArg = process.argv.indexOf("--dir");
const HERE = dirArg > 0 ? path.resolve(ROOT, process.argv[dirArg + 1]) : ROOT;
const outName = dirArg > 0 ? path.basename(HERE) + ".mp4" : "sarfli-explainer.mp4";
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
  // Frames are piped straight into ffmpeg, so no frame images are written to disk.
  // --out <file.mp4>: write the video somewhere else (e.g. another drive)
  const outArg = process.argv.indexOf("--out");
  const out = outArg > 0 ? path.resolve(process.argv[outArg + 1]) : path.join(HERE, "out", outName);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const ff = spawn(ffmpeg, [
    "-y", "-loglevel", "error",
    "-f", "image2pipe", "-framerate", String(FPS), "-c:v", "mjpeg", "-i", "-",
    "-i", path.join(HERE, "audio", "master.wav"),
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-threads", "2", "-pix_fmt", "yuv420p", "-movflags", "+faststart",
    "-c:a", "aac", "-b:a", "192k", "-shortest", out,
  ], { stdio: ["pipe", "inherit", "inherit"] });
  const done = new Promise((res, rej) => ff.on("close", (c) => (c === 0 ? res() : rej(new Error("ffmpeg failed")))));
  const n = Math.ceil(totalSec * FPS);
  const t0 = Date.now();
  for (let i = 0; i < n; i++) {
    await page.evaluate((t) => window.render(t), (i / FPS) * 1000);
    const { data } = await cdp.send("Page.captureScreenshot", { format: "jpeg", quality: 93, captureBeyondViewport: false });
    if (!ff.stdin.write(Buffer.from(data, "base64"))) await new Promise((r) => ff.stdin.once("drain", r));
    if (i % 300 === 0) console.log(`frame ${i}/${n}  ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  }
  ff.stdin.end();
  await done;
  console.log("video written to", out, `(${(fs.statSync(out).size / 1e6).toFixed(1)} MB, ${totalSec.toFixed(1)}s)`);
}
await browser.close();
