import { Card, CardDescription, CardHeader, CardPanel, CardTitle } from "@/components/ui/card";

export function StatCard({ label, value, hint }: { label: string; value: React.ReactNode; hint?: React.ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardDescription>{label}</CardDescription>
        <CardTitle className="text-2xl tabular">{value}</CardTitle>
      </CardHeader>
      {hint && <CardPanel className="text-muted-foreground text-xs">{hint}</CardPanel>}
    </Card>
  );
}
