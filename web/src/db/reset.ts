import "dotenv/config";
import { resetAndSeed } from "./seed-data";

// Dev only: wipes every table and seeds defaults + demo data. Same as the button on the admin Settings page.
async function main() {
  const emails = await resetAndSeed();
  console.log(`reset ok — log in with the dev login as: ${emails.join(", ")}`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
