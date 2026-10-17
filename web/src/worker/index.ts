import "dotenv/config";
import { tick } from "@/lib/engine/tick";

// Background worker: expiries, timeouts, balance polling and queue assignment.
// Run alongside the web server: `pnpm worker`.
const INTERVAL_MS = 2000;
let running = true;

async function loop() {
  console.log(`[worker] started, tick every ${INTERVAL_MS}ms`);
  while (running) {
    const started = Date.now();
    try {
      await tick();
    } catch (err) {
      console.error("[worker] tick failed", err);
    }
    await new Promise((r) => setTimeout(r, Math.max(0, INTERVAL_MS - (Date.now() - started))));
  }
  process.exit(0);
}

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    console.log(`[worker] ${sig}, finishing current tick`);
    running = false;
  });
}

void loop();
