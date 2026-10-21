// Screenshots the landing page in a given locale, one image per screen, and reports sideways overflow.
import { Browser, sleep } from "file:///C:/Users/INFOTEC/.claude/skills/design-taste-frontend/scripts/lib/cdp.mjs";
const [locale = "ar", out = ".taste-skill/ar"] = process.argv.slice(2);
const browser = await Browser.launch();
for (const [name, w, h, mobile] of [["d", 1440, 900, false], ["m", 390, 844, true]]) {
  const page = await browser.newPage({ width: w, height: h, mobile });
  await page.goto("http://localhost:3100/login");
  await page.eval(`document.cookie = "locale=${locale}; path=/"`);
  await page.goto("http://localhost:3100/", { settleMs: 2500 });
  const total = await page.eval("document.documentElement.scrollHeight");
  const over = await page.eval("document.documentElement.scrollWidth - innerWidth");
  console.log(name, "height", total, "sideways overflow", over);
  for (let y = 0, i = 0; y < total; y += h, i++) {
    await page.eval(`window.scrollTo(0, ${y})`);
    await sleep(1300);
    await page.screenshot({ path: `${out}/${name}-${String(i).padStart(2, "0")}.jpg` });
  }
  await page.close();
}
await browser.close();
