import "dotenv/config";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

// Applies pending SQL migrations from ./drizzle. Safe to run on every start.
async function main() {
  const client = postgres(process.env.DATABASE_URL ?? "postgres://rasseed:rasseed@localhost:5433/rasseed", {
    max: 1,
    onnotice: () => {}, // "already exists, skipping" notices on re-runs
  });
  await migrate(drizzle(client), { migrationsFolder: "./drizzle" });
  await client.end();
  console.log("migrations ok");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
