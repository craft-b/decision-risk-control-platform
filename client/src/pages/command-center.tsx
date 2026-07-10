import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { RiskBadge } from "@/components/risk-badge";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Activity,
  ShieldAlert,
  DollarSign,
  Wrench,
  ArrowRight,
  TrendingUp,
  TrendingDown,
  Minus,
  Calendar,
  ChevronRight,
} from "lucide-react";
import { Link } from "wouter";
import { cn } from "@/lib/utils";
import { useEquipment } from "@/hooks/use-equipment";
import { useMaintenanceDueSoon } from "@/hooks/use-maintenance";
import { useLatestMultiHorizonPredictions } from "@/hooks/use-risk-score";
import { useSimulationState } from "@/hooks/use-predictive-maintenance";
import { fmtMoneyCompact } from "@/lib/chart-theme";
import { FAILURE_DOWNTIME_DAYS } from "@/lib/cost-model";
import {
  RiskLevel,
  RISK_FILL,
  RISK_HOVER,
  humanizeDriver,
} from "@/lib/risk-format";
import { format } from "date-fns";

type Horizon = "10d" | "30d" | "60d";

interface FleetRow {
  id: number;
  name: string;
  code: string;
  category: string;
  dailyRate: number;
  trend: "INCREASING" | "DECREASING" | "STABLE";
  driver: string | null;
  probs: Record<Horizon, number>;
  levels: Record<Horizon, RiskLevel>;
}

function safeDrivers(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw as string[];
  if (typeof raw === "string") {
    try {
      const d = JSON.parse(raw || "[]");
      return Array.isArray(d) ? d : [];
    } catch {
      return [];
    }
  }
  return [];
}

function TrendIcon({ trend }: { trend: FleetRow["trend"] }) {
  if (trend === "INCREASING") return <TrendingUp className="h-4 w-4 text-risk-high" />;
  if (trend === "DECREASING") return <TrendingDown className="h-4 w-4 text-risk-low" />;
  return <Minus className="h-4 w-4 text-muted-foreground" />;
}

function KpiCard({
  label,
  value,
  sub,
  icon: Icon,
  accent,
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  icon: React.ComponentType<{ className?: string }>;
  accent?: string;
}) {
  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-start justify-between">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            {label}
          </p>
          <Icon className={cn("h-4 w-4", accent ?? "text-muted-foreground/60")} />
        </div>
        <p className="mt-2 text-3xl font-semibold tracking-tight tabular-nums text-foreground">
          {value}
        </p>
        {sub && <div className="mt-1.5 text-xs text-muted-foreground">{sub}</div>}
      </CardContent>
    </Card>
  );
}

export default function CommandCenter() {
  const { data: equipment } = useEquipment();
  const { data: predictions } = useLatestMultiHorizonPredictions();
  const { data: dueSoon } = useMaintenanceDueSoon();
  const sim = useSimulationState();

  const asOf = sim.data?.cursor_date
    ? new Date(String(sim.data.cursor_date).substring(0, 10))
    : new Date();

  const rows: FleetRow[] = (predictions ?? []).map((p: any) => {
    const id = p.equipmentId ?? p.equipment_id;
    const equip = equipment?.find((e) => e.id === id);
    return {
      id,
      name: equip?.name ?? p.name ?? `Equipment ${id}`,
      code: equip?.equipmentId ?? p.equipment_code ?? "",
      category: equip?.category ?? p.category ?? "",
      dailyRate: Number(equip?.dailyRate ?? 0),
      trend: (p.risk_trend ?? p.riskTrend ?? "STABLE") as FleetRow["trend"],
      driver: (() => {
        const d = safeDrivers(p.top_drivers_30d);
        return d.length ? humanizeDriver(d[0]) : null;
      })(),
      probs: {
        "10d": Number(p.prob_10d ?? 0),
        "30d": Number(p.prob_30d ?? 0),
        "60d": Number(p.prob_60d ?? 0),
      },
      levels: {
        "10d": (p.risk_level_10d ?? "LOW") as RiskLevel,
        "30d": (p.risk_level_30d ?? "LOW") as RiskLevel,
        "60d": (p.risk_level_60d ?? "LOW") as RiskLevel,
      },
    };
  });

  const total = rows.length;
  const high = rows.filter((r) => r.levels["30d"] === "HIGH").length;
  const medium = rows.filter((r) => r.levels["30d"] === "MEDIUM").length;
  const low = rows.filter((r) => r.levels["30d"] === "LOW").length;

  // Fleet Health Index — share of the fleet not carrying elevated 30-day risk,
  // with MEDIUM counted at half weight. Honest, bounded 0–100.
  const fleetHealth = total > 0 ? Math.round((100 * (low + 0.5 * medium)) / total) : 100;

  // Expected downtime dollars at risk = Σ over elevated units of
  // P(failure, 30d) × daily rate × typical unplanned-downtime days.
  const downtimeAtRisk = rows
    .filter((r) => r.levels["30d"] !== "LOW")
    .reduce((sum, r) => sum + r.probs["30d"] * r.dailyRate * FAILURE_DOWNTIME_DAYS, 0);

  const overdue = (dueSoon ?? []).filter((d) => Number(d.daysUntilDue) < 0).length;
  const dueNext = (dueSoon ?? []).filter((d) => Number(d.daysUntilDue) >= 0).length;

  const queue = [...rows]
    .sort((a, b) => b.probs["30d"] - a.probs["30d"])
    .slice(0, 12);

  const healthAccent =
    fleetHealth >= 75 ? "text-risk-low" : fleetHealth >= 50 ? "text-risk-medium" : "text-risk-high";

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      {/* Header */}
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Fleet Command Center</h1>
          <p className="text-muted-foreground">
            Fleet health, predicted failures, and this week&apos;s maintenance priorities
          </p>
        </div>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Calendar className="h-4 w-4" />
          <span className="tabular-nums">As of {format(asOf, "MMM d, yyyy")}</span>
        </div>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="Fleet Health Index"
          value={<span className={healthAccent}>{fleetHealth}</span>}
          sub={
            <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="inline-flex items-center gap-1">
                <span className="h-1.5 w-1.5 rounded-full bg-risk-low" />
                {low} low
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="h-1.5 w-1.5 rounded-full bg-risk-medium" />
                {medium} med
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="h-1.5 w-1.5 rounded-full bg-risk-high" />
                {high} high
              </span>
            </span>
          }
          icon={Activity}
          accent={healthAccent}
        />
        <KpiCard
          label="High-Risk Assets · 30d"
          value={high}
          sub={`of ${total} scored units need attention`}
          icon={ShieldAlert}
          accent={high > 0 ? "text-risk-high" : "text-risk-low"}
        />
        <KpiCard
          label="Downtime $ at Risk · 30d"
          value={fmtMoneyCompact(downtimeAtRisk)}
          sub="Expected cost of unplanned failures"
          icon={DollarSign}
          accent="text-risk-medium"
        />
        <KpiCard
          label="PM Backlog"
          value={overdue + dueNext}
          sub={
            <span>
              <span className={overdue > 0 ? "text-risk-high font-medium" : ""}>{overdue} overdue</span>
              {" · "}
              {dueNext} due soon
            </span>
          }
          icon={Wrench}
          accent={overdue > 0 ? "text-risk-high" : "text-muted-foreground/60"}
        />
      </div>

      {/* Risk queue */}
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
          <div>
            <CardTitle>Priority Risk Queue</CardTitle>
            <CardDescription>
              Highest 30-day failure probability first · click a unit for full multi-horizon breakdown
            </CardDescription>
          </div>
          <Button asChild variant="outline" size="sm" className="shrink-0">
            <Link href="/predictive-maintenance">
              View all <ArrowRight className="ml-1 h-3.5 w-3.5" />
            </Link>
          </Button>
        </CardHeader>
        <CardContent>
          {queue.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground">
              No predictions yet. Open{" "}
              <Link href="/predictive-maintenance" className="text-primary underline underline-offset-2">
                Predictive Maintenance
              </Link>{" "}
              and run the model to populate the queue.
            </div>
          ) : (
            <div>
              {/* Column header */}
              <div className="hidden md:flex items-center gap-4 px-3 pb-2 mb-1 border-b border-border text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                <div className="w-[240px] shrink-0">Asset</div>
                <div className="flex-1 min-w-0 hidden lg:block">Primary risk driver</div>
                <div className="w-[228px] shrink-0 text-center">Failure probability · 10 / 30 / 60d</div>
                <div className="w-[132px] shrink-0 text-right pr-6">Status</div>
              </div>

              <div className="space-y-0.5">
                {queue.map((r) => (
                  <Link
                    key={r.id}
                    href="/predictive-maintenance"
                    className={cn(
                      "flex items-center gap-4 px-3 py-2.5 rounded-md cursor-pointer transition-colors group border border-transparent",
                      RISK_HOVER[r.levels["30d"]],
                    )}
                  >
                    {/* Asset */}
                    <div className="w-[240px] shrink-0 min-w-0">
                      <p className="text-sm font-medium truncate text-foreground">{r.name}</p>
                      <p className="text-xs text-muted-foreground font-mono">
                        {r.category}
                        {r.code ? ` · ${r.code}` : ""}
                      </p>
                    </div>

                    {/* Primary driver */}
                    <div className="hidden lg:flex flex-1 min-w-0 items-center gap-2">
                      <span className={cn("h-1.5 w-1.5 rounded-full shrink-0", RISK_FILL[r.levels["30d"]])} />
                      <span className="truncate text-sm text-muted-foreground">
                        {r.driver ?? <span className="italic opacity-70">No dominant driver</span>}
                      </span>
                    </div>

                    {/* Tri-horizon bars */}
                    <div className="hidden md:flex items-center gap-3 shrink-0 w-[228px] justify-center">
                      {(["10d", "30d", "60d"] as Horizon[]).map((h) => (
                        <TooltipProvider key={h}>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <div className="flex flex-col items-center gap-1 w-16">
                                <div className="text-[10px] font-medium text-muted-foreground">{h}</div>
                                <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden">
                                  <div
                                    className={cn("h-full rounded-full", RISK_FILL[r.levels[h]])}
                                    style={{ width: `${Math.round(r.probs[h] * 100)}%` }}
                                  />
                                </div>
                                <div className="text-xs font-semibold font-mono tabular-nums text-foreground">
                                  {Math.round(r.probs[h] * 100)}%
                                </div>
                              </div>
                            </TooltipTrigger>
                            <TooltipContent>
                              <p>
                                {h}: {r.levels[h]} ({Math.round(r.probs[h] * 100)}% failure probability)
                              </p>
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      ))}
                    </div>

                    {/* Status */}
                    <div className="flex items-center justify-end gap-2 shrink-0 w-[132px]">
                      <TrendIcon trend={r.trend} />
                      <RiskBadge
                        level={r.levels["30d"]}
                        score={Math.round(r.probs["30d"] * 100)}
                        size="sm"
                        showIcon={false}
                      />
                      <ChevronRight className="h-4 w-4 text-muted-foreground/60 shrink-0" />
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
