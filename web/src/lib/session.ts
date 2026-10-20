import "server-only";
import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { db } from "@/db";
import { STAFF_ROLES, users } from "@/db/schema";

export type CurrentUser = typeof users.$inferSelect;

export async function getCurrentUser(): Promise<CurrentUser | null> {
  const session = await auth();
  const id = session?.user?.id;
  if (!id) return null;
  const [user] = await db.select().from(users).where(eq(users.id, id));
  return user && !user.blocked ? user : null;
}

export async function requireUser() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

export const isStaff = (user: CurrentUser | null | undefined) => Boolean(user && STAFF_ROLES.includes(user.role));
export const isAdmin = (user: CurrentUser | null | undefined) => user?.role === "admin";

/** Admin or manager: may use the operations part of the console. */
export async function requireStaff() {
  const user = await requireUser();
  if (!isStaff(user)) redirect("/");
  return user;
}

/** Admin only: setup pages and user management. */
export async function requireAdmin() {
  const user = await requireUser();
  if (!isAdmin(user)) redirect("/admin");
  return user;
}
