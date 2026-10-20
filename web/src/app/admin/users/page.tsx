import Link from "next/link";
import { Dt } from "@/components/app/money";
import { PageHeader } from "@/components/admin/page-header";
import { TimeAgo } from "@/components/admin/time-ago";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Frame } from "@/components/ui/frame";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { listUsers } from "@/lib/admin-queries";
import { requireStaff } from "@/lib/session";
import { AdjustBalanceButton, BlockButton, RoleSelect } from "./user-actions";

export const metadata = { title: "Sellers & balances" };

export default async function UsersPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const me = await requireStaff();
  const { q = "" } = await searchParams;
  const rows = await listUsers(q || undefined);
  const admin = me.role === "admin";
  const owed = rows.reduce((s, r) => s + r.balanceMillimes, 0);

  return (
    <>
      <PageHeader
        title="Sellers & balances"
        description={admin ? "Everyone who signed in. Admins set roles and block accounts; staff can adjust balances." : "Everyone who signed in. You can adjust balances with a note."}
        actions={
          <form className="flex gap-2" action="/admin/users">
            <Input type="search" name="q" defaultValue={q} placeholder="name or e-mail" aria-label="Search users" className="w-56" />
            <Button type="submit" variant="outline">
              Search
            </Button>
          </form>
        }
      />
      <p className="text-sm">
        {rows.length} users · balances total <Dt millimes={owed} className="font-semibold" />
      </p>
      <Frame>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>User</TableHead>
              <TableHead>Role</TableHead>
              <TableHead className="text-right">Balance</TableHead>
              <TableHead className="text-right">Sales</TableHead>
              <TableHead>Joined</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-muted-foreground">
                  No users.
                </TableCell>
              </TableRow>
            )}
            {rows.map(({ user, balanceMillimes, sales }) => (
              <TableRow key={user.id}>
                <TableCell>
                  <Link href={`/admin/users/${user.id}`} className="flex flex-col underline-offset-4 hover:underline">
                    <span className="font-medium">{user.name ?? user.email}</span>
                    <span className="text-muted-foreground text-xs">{user.email}</span>
                  </Link>
                  {user.blocked && (
                    <Badge variant="error" className="mt-1">
                      Blocked
                    </Badge>
                  )}
                </TableCell>
                <TableCell>
                  {admin ? <RoleSelect userId={user.id} role={user.role} disabled={user.id === me.id} /> : <Badge variant={user.role === "seller" ? "secondary" : "info"}>{user.role}</Badge>}
                </TableCell>
                <TableCell className="text-right">
                  <Dt millimes={balanceMillimes} className={balanceMillimes > 0 ? "font-semibold" : ""} />
                </TableCell>
                <TableCell className="text-right">{sales}</TableCell>
                <TableCell className="text-muted-foreground text-xs">
                  <TimeAgo date={user.createdAt} />
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-2">
                    <AdjustBalanceButton userId={user.id} name={user.name ?? user.email ?? "user"} />
                    {admin && <BlockButton userId={user.id} blocked={user.blocked} disabled={user.id === me.id} />}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Frame>
    </>
  );
}
