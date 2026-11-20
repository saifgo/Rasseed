import "dotenv/config";
import { sql } from "drizzle-orm";
import { db } from "./index";
import { seedDefaults } from "./seed-data";

// Idempotent: inserts defaults, never overwrites what the admin has changed.
async function main() {
  await seedDefaults();
  const [{ count }] = await db.execute<{ count: string }>(sql`select count(*)::text as count from operators`);
  console.log(`seed ok (${count} operators)`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
