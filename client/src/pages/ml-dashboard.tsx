import {
  useModelMetrics,
  useDriftStatus,
  useComputeDriftReference,
  usePredictionDrift,
  useBiasDrift,
  useModelRegistry,
  useChampionChallengerCompare,
  usePromoteChallenger,
  useDataQualityReport,
  type HorizonMetrics,
  type DQCheck,
} from "@/hooks/use-predictive-maintenance";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  LineChart,
  Line,
  Legend,
  Cell,
} from "recharts";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";
import {
  Activity,
  TrendingUp,
  Target,
  AlertCircle,
  CheckCircle2,
  Brain,
  Database,
  Zap,
  Loader2,
  ShieldAlert,
  RefreshCw,
  ListChecks,
  ArrowRight,
  Trophy,
  Swords,
  Crown,
  Clock,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";

const PSI_THRESHOLDS = { WARNING: 0.1, ALERT: 0.2 };

const FEATURE_LABELS: Record<string, string> = {
  mean_time_between_failures: "Mean Time Between Failures",
  vendor_reliability_score:   "Vendor Reliability Score",
  mechanical_wear_score:      "Mechanical Wear Score",
  neglect_score:              "Neglect Score",
  hours_used_90d:             "Hours Used (90d)",
};

function statusBadgeClass(status: string) {
  return status === "ALERT"   ? "bg-red-100 text-red-800 border-red-300" :
         status === "WARNING" ? "bg-yellow-100 text-yellow-800 border-yellow-300" :
                                "bg-green-100 text-green-800 border-green-300";
}

function statusBorderClass(status: string) {
  return status === "ALERT"   ? "border-red-500 bg-red-50" :
         status === "WARNING" ? "border-yellow-500 bg-yellow-50" :
         status === "STABLE"  ? "border-green-500 bg-green-50" :
                                "border-slate-200";
}

function statusTextClass(status: string) {
  return status === "ALERT"   ? "text-red-700" :
         status === "WARNING" ? "text-yellow-700" :
         status === "STABLE"  ? "text-green-700" :
                                "text-slate-500";
}

function DriftMonitorCard() {
  const { data: drift, isLoading, error } = useDriftStatus();
  const computeRef = useComputeDriftReference();
  const { user } = useAuth();
  const isAdmin = (user as any)?.role === "ADMINISTRATOR";

  const overallColor     = statusBorderClass(drift?.overall ?? "");
  const overallTextColor = statusTextClass(drift?.overall ?? "");

  return (
    <Card className={`border-l-4 ${overallColor}`}>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
        <div className="flex items-center gap-2">
          <ShieldAlert className={`h-5 w-5 ${overallTextColor}`} />
          <div>
            <CardTitle>Feature Drift Monitor</CardTitle>
            <CardDescription>
              Population Stability Index vs. training distribution
            </CardDescription>
          </div>
        </div>
        {isAdmin && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => computeRef.mutate()}
            disabled={computeRef.isPending}
          >
            {computeRef.isPending
              ? <Loader2 className="h-3 w-3 animate-spin mr-1" />
              : <RefreshCw className="h-3 w-3 mr-1" />}
            Reset Baseline
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {isLoading && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading drift metrics…
          </div>
        )}
        {(error || (drift?.overall === "NO_DATA" && !isLoading)) && (
          <div className="space-y-2">
            <Alert className="border-slate-200">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription className="text-sm">
                No drift data yet. {isAdmin ? "Click \"Reset Baseline\" to compute a reference distribution from current training data." : "A baseline has not been computed yet."}
              </AlertDescription>
            </Alert>
          </div>
        )}
        {drift && drift.overall !== "NO_DATA" && (
          <div className="space-y-4">
            {/* Overall status */}
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">Overall status:</span>
              <Badge className={statusBadgeClass(drift.overall)}>
                {drift.overall}
              </Badge>
              {drift.features[0] && (
                <span className="text-xs text-muted-foreground ml-auto">
                  Last checked {new Date(drift.features[0].checked_at).toLocaleString()}
                </span>
              )}
            </div>

            {/* Per-feature rows */}
            <div className="space-y-3">
              {drift.features.map((f) => {
                const psiPct = Math.min(f.psi / PSI_THRESHOLDS.ALERT, 1);
                const barColor =
                  f.status === "ALERT"   ? "bg-red-500" :
                  f.status === "WARNING" ? "bg-yellow-400" :
                                          "bg-green-500";
                return (
                  <div key={f.feature} className="space-y-1">
                    <div className="flex items-center justify-between text-sm">
                      <span className="font-medium">
                        {FEATURE_LABELS[f.feature] ?? f.feature}
                      </span>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs text-muted-foreground">
                          PSI {f.psi.toFixed(4)}
                        </span>
                        <Badge
                          variant="outline"
                          className={
                            f.status === "ALERT"   ? "text-red-700 border-red-300" :
                            f.status === "WARNING" ? "text-yellow-700 border-yellow-300" :
                                                     "text-green-700 border-green-300"
                          }
                        >
                          {f.status}
                        </Badge>
                      </div>
                    </div>
                    <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${barColor}`}
                        style={{ width: `${psiPct * 100}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Legend */}
            <div className="flex gap-4 text-xs text-muted-foreground pt-1">
              <span><span className="font-medium text-green-600">Stable</span> PSI &lt; 0.10</span>
              <span><span className="font-medium text-yellow-600">Warning</span> 0.10 – 0.20</span>
              <span><span className="font-medium text-red-600">Alert</span> &gt; 0.20 → retrain recommended</span>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Prediction Drift Card ─────────────────────────────────────────────────────

function PredictionDriftCard() {
  const { data, isLoading } = usePredictionDrift();

  const overall     = data?.overall ?? "NO_DATA";
  const borderClass = statusBorderClass(overall);
  const textClass   = statusTextClass(overall);

  return (
    <Card className={`border-l-4 ${borderClass}`}>
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <TrendingUp className={`h-5 w-5 ${textClass}`} />
          <div>
            <CardTitle>Prediction Drift Monitor</CardTitle>
            <CardDescription>
              Output score distribution shift per horizon — detects confidence profile changes
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading prediction drift…
          </div>
        )}
        {!isLoading && overall === "NO_DATA" && (
          <Alert className="border-slate-200">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription className="text-sm">
              No prediction drift data yet — run a batch prediction to populate.
            </AlertDescription>
          </Alert>
        )}
        {data && overall !== "NO_DATA" && (
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">Overall:</span>
              <Badge className={statusBadgeClass(overall)}>{overall}</Badge>
              {data.horizons[0] && (
                <span className="text-xs text-muted-foreground ml-auto">
                  Last checked {new Date(data.horizons[0].checked_at).toLocaleString()}
                </span>
              )}
            </div>

            <div className="space-y-3">
              {data.horizons.map((h) => {
                const psiPct   = Math.min(h.score_psi / 0.20, 1);
                const barColor = h.score_status === "ALERT"   ? "bg-red-500" :
                                 h.score_status === "WARNING" ? "bg-yellow-400" :
                                                               "bg-green-500";
                const highDelta  = ((h.high_pct   - h.ref_high_pct)   * 100).toFixed(1);
                const highArrow  = h.high_pct > h.ref_high_pct ? "↑" : h.high_pct < h.ref_high_pct ? "↓" : "–";
                return (
                  <div key={h.horizon} className="space-y-1">
                    <div className="flex items-center justify-between text-sm">
                      <span className="font-medium">{h.horizon}d horizon</span>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <span className="font-mono">PSI {h.score_psi.toFixed(4)}</span>
                        <Badge variant="outline" className={statusBadgeClass(h.score_status)}>
                          {h.score_status}
                        </Badge>
                      </div>
                    </div>
                    <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                      <div className={`h-full rounded-full transition-all ${barColor}`}
                           style={{ width: `${psiPct * 100}%` }} />
                    </div>
                    <div className="flex gap-3 text-xs text-muted-foreground">
                      <span>HIGH: {(h.high_pct * 100).toFixed(1)}% (ref {(h.ref_high_pct * 100).toFixed(1)}%) {highArrow}{Math.abs(parseFloat(highDelta))}pp</span>
                      <span>MED: {(h.medium_pct * 100).toFixed(1)}%</span>
                      <span>LOW: {(h.low_pct * 100).toFixed(1)}%</span>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="flex gap-4 text-xs text-muted-foreground pt-1">
              <span><span className="font-medium text-green-600">Stable</span> PSI &lt; 0.10</span>
              <span><span className="font-medium text-yellow-600">Warning</span> 0.10 – 0.20</span>
              <span><span className="font-medium text-red-600">Alert</span> &gt; 0.20 → investigate</span>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Bias Drift Card ───────────────────────────────────────────────────────────

function BiasDriftCard() {
  const { data, isLoading } = useBiasDrift();

  const overall     = data?.overall ?? "NO_DATA";
  const borderClass = statusBorderClass(overall);
  const textClass   = statusTextClass(overall);

  return (
    <Card className={`border-l-4 ${borderClass}`}>
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <Target className={`h-5 w-5 ${textClass}`} />
          <div>
            <CardTitle>Bias Drift Monitor</CardTitle>
            <CardDescription>
              Per-category HIGH-risk rate vs. training baseline (30d horizon)
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading bias metrics…
          </div>
        )}
        {!isLoading && overall === "NO_DATA" && (
          <Alert className="border-slate-200">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription className="text-sm">
              No bias data yet — run a batch prediction to populate.
            </AlertDescription>
          </Alert>
        )}
        {data && overall !== "NO_DATA" && (
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">Overall:</span>
              <Badge className={statusBadgeClass(overall)}>{overall}</Badge>
              <span className="text-xs text-muted-foreground ml-auto">
                Threshold: ±15pp deviation
              </span>
            </div>

            <div className="space-y-2">
              {data.categories.map((c) => {
                const isAlert   = Boolean(c.alert);
                const deviationPct = (c.deviation * 100).toFixed(1);
                const highPct      = (c.high_pct * 100).toFixed(1);
                const refPct       = (c.ref_high_pct * 100).toFixed(1);
                const direction    = c.high_pct > c.ref_high_pct ? "over-predicting" : "under-predicting";
                return (
                  <div
                    key={c.category}
                    className={`flex items-center justify-between rounded-md px-3 py-2 text-sm ${
                      isAlert ? "bg-red-50 border border-red-200" : "bg-slate-50"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      {isAlert
                        ? <AlertCircle className="h-4 w-4 text-red-500 shrink-0" />
                        : <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />}
                      <span className="font-medium">{c.category}</span>
                    </div>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                      <span>HIGH: {highPct}% (ref {refPct}%)</span>
                      <Badge
                        variant="outline"
                        className={isAlert ? "text-red-700 border-red-300" : "text-green-700 border-green-300"}
                      >
                        {isAlert ? `${direction} by ${deviationPct}pp` : `±${deviationPct}pp`}
                      </Badge>
                    </div>
                  </div>
                );
              })}
            </div>

            <p className="text-xs text-muted-foreground">
              Alerts when any category's HIGH% deviates &gt;15pp from its training baseline —
              indicates the model may be systematically mis-scoring a specific asset type.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Data Quality Card ─────────────────────────────────────────────────────────

function dqStatusIcon(status: DQCheck["status"]) {
  if (status === "PASS") return <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0 mt-0.5" />;
  if (status === "WARN") return <AlertCircle  className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />;
  return <XCircle className="h-4 w-4 text-red-500 shrink-0 mt-0.5" />;
}

function DataQualityCard() {
  const { data: report, isLoading, error, refetch, isFetching } = useDataQualityReport();

  const overallColor =
    !report            ? "border-slate-200" :
    report.overall === "PASS" ? "border-green-200 bg-green-50/40" :
    report.overall === "WARN" ? "border-amber-200 bg-amber-50/40" :
                                "border-red-200 bg-red-50/40";

  const overallBadge =
    !report            ? null :
    report.overall === "PASS" ? "bg-green-100 text-green-800 border-green-300" :
    report.overall === "WARN" ? "bg-amber-100 text-amber-800 border-amber-300" :
                                "bg-red-100 text-red-800 border-red-300";

  return (
    <Card className={overallColor}>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-slate-600" />
            <CardTitle>Training Data Quality</CardTitle>
            {report && (
              <Badge className={`text-xs border ${overallBadge}`}>{report.overall}</Badge>
            )}
          </div>
          <button
            onClick={() => refetch()}
            disabled={isFetching}
            className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium hover:bg-muted transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`h-3 w-3 ${isFetching ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>
        <CardDescription>
          Runs before every training job — blocks on FAIL, warns on WARN.
          {report && (
            <span className="ml-1">
              {report.pass_count}✓ {report.warn_count > 0 && `${report.warn_count}⚠ `}{report.fail_count > 0 && `${report.fail_count}✗ `}
              · {report.total_rows.toLocaleString()} labeled rows
            </span>
          )}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Running checks…
          </div>
        )}
        {error && (
          <p className="text-sm text-muted-foreground">
            Could not run quality checks — ML service may be offline or no training data exists yet.
          </p>
        )}
        {report && (
          <div className="space-y-1.5">
            <p className="text-sm text-muted-foreground mb-3">{report.summary}</p>
            {report.checks.map((c) => (
              <div key={c.check} className="flex items-start gap-2 text-sm">
                {dqStatusIcon(c.status)}
                <div className="min-w-0">
                  <span className="font-mono text-xs text-muted-foreground mr-2">{c.check}</span>
                  <span className={
                    c.status === "FAIL" ? "text-red-700" :
                    c.status === "WARN" ? "text-amber-700" : "text-slate-700"
                  }>{c.message}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Champion-Challenger Card ──────────────────────────────────────────────────

function MetricCell({ label, value }: { label: string; value: number | null | undefined }) {
  if (value == null) return <span className="text-muted-foreground text-xs">—</span>;
  const pct = value <= 1 ? (value * 100).toFixed(1) + "%" : value.toFixed(3);
  return (
    <div className="text-center">
      <div className="text-sm font-semibold">{pct}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}

function HorizonRow({
  horizon,
  champ,
  chal,
}: {
  horizon: string;
  champ: HorizonMetrics | undefined;
  chal:  HorizonMetrics | undefined;
}) {
  const delta = (champ?.roc_auc != null && chal?.roc_auc != null)
    ? chal.roc_auc - champ.roc_auc
    : null;

  return (
    <div className="grid grid-cols-[5rem_1fr_1fr_6rem] gap-2 items-center py-2 border-b last:border-0">
      <span className="text-sm font-medium text-center">{horizon}</span>
      <div className="flex justify-around">
        <MetricCell label="ROC-AUC"  value={champ?.roc_auc} />
        <MetricCell label="Recall"   value={champ?.recall_fail} />
        <MetricCell label="PR-AUC"   value={champ?.pr_auc} />
      </div>
      <div className="flex justify-around">
        <MetricCell label="ROC-AUC"  value={chal?.roc_auc} />
        <MetricCell label="Recall"   value={chal?.recall_fail} />
        <MetricCell label="PR-AUC"   value={chal?.pr_auc} />
      </div>
      <div className="text-center text-xs font-mono">
        {delta != null ? (
          <span className={delta > 0.005 ? "text-green-600 font-semibold" : delta < -0.005 ? "text-red-500 font-semibold" : "text-muted-foreground"}>
            {delta > 0 ? "+" : ""}{(delta * 100).toFixed(1)}pp
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </div>
    </div>
  );
}

function ChampionChallengerCard() {
  const { data: compare, isLoading } = useChampionChallengerCompare();
  const { data: registry }           = useModelRegistry();
  const promote                      = usePromoteChallenger();
  const { data: authData }           = useQuery({ queryKey: ["/api/auth/me"] } as any) as any;
  const isAdmin = authData?.role === "ADMINISTRATOR";

  if (isLoading) {
    return (
      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><Swords className="h-5 w-5" />Champion vs Challenger</CardTitle></CardHeader>
        <CardContent><Loader2 className="h-5 w-5 animate-spin" /></CardContent>
      </Card>
    );
  }

  if (!compare) return null;

  const horizons = ["10d", "30d", "60d"];

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Swords className="h-5 w-5 text-purple-600" />
              Champion vs Challenger
            </CardTitle>
            <CardDescription className="mt-1">
              Challenger runs in{" "}
              <span className="font-medium text-amber-600">shadow mode</span>{" "}
              — scores every batch but predictions are not persisted until promoted.
            </CardDescription>
          </div>
          {compare.challenger && isAdmin && (
            <button
              onClick={() => promote.mutate()}
              disabled={promote.isPending}
              className="inline-flex items-center gap-2 rounded-lg bg-purple-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-purple-700 disabled:opacity-50 transition-colors"
            >
              {promote.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Crown className="h-4 w-4" />
              )}
              Promote Challenger
            </button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Version badges */}
        <div className="grid grid-cols-[5rem_1fr_1fr_6rem] gap-2 items-center">
          <span />
          <div className="flex items-center gap-2 justify-center">
            <Trophy className="h-4 w-4 text-yellow-500" />
            <span className="font-semibold text-sm">{compare.champion.version ?? "—"}</span>
            <Badge className="bg-yellow-100 text-yellow-800 border-yellow-300 text-xs">champion</Badge>
          </div>
          <div className="flex items-center gap-2 justify-center">
            <Swords className="h-4 w-4 text-purple-500" />
            <span className="font-semibold text-sm">{compare.challenger?.version ?? "—"}</span>
            {compare.challenger ? (
              <Badge className="bg-purple-100 text-purple-800 border-purple-300 text-xs">challenger</Badge>
            ) : (
              <span className="text-xs text-muted-foreground italic">no challenger</span>
            )}
          </div>
          <div className="text-center text-xs text-muted-foreground font-medium">Δ ROC-AUC</div>
        </div>

        {/* Per-horizon rows */}
        <div>
          {horizons.map((h) => (
            <HorizonRow
              key={h}
              horizon={h}
              champ={compare.champion.metrics?.[h]}
              chal={compare.challenger?.metrics?.[h]}
            />
          ))}
        </div>

        {/* History */}
        {registry && registry.history.length > 0 && (
          <div className="space-y-1 pt-2">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Promotion history</p>
            {registry.history.slice(-4).reverse().map((ev, i) => (
              <div key={i} className="flex items-center gap-2 text-xs text-muted-foreground">
                <Clock className="h-3 w-3 shrink-0" />
                <span className="font-mono">{ev.version ?? (ev as any).new_champion ?? "—"}</span>
                <span className="capitalize">{ev.event.replace(/_/g, " ")}</span>
                {ev.role && <Badge variant="outline" className="text-[10px] px-1 py-0">{ev.role}</Badge>}
                <span className="ml-auto">{new Date(ev.timestamp).toLocaleDateString()}</span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function MLPerformanceDashboard() {
  const { data: modelMetrics, isLoading, error } = useModelMetrics();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <Loader2 className="h-8 w-8 animate-spin text-blue-600 mx-auto mb-4" />
          <p className="text-muted-foreground">Loading model metrics...</p>
        </div>
      </div>
    );
  }

  if (error || !modelMetrics) {
    const steps = [
      {
        done: true,
        label: "System initialized",
        detail: "Database ready and schema applied",
      },
      {
        done: false,
        label: "Add equipment",
        detail: "At least one asset is required to generate sensor data",
        href: "/equipment/new",
        action: "Add Equipment",
      },
      {
        done: false,
        label: "Run demo seed (or accumulate live data)",
        detail: "Load Demo Data on the Setup page to populate historical snapshots and failure events",
        href: "/setup",
        action: "Go to Setup",
      },
      {
        done: false,
        label: "Train the model",
        detail: "Once ≥100 labeled snapshots exist, trigger training from the Predictive Maintenance page",
        href: "/predictive-maintenance",
        action: "Predictive Maintenance",
      },
    ];

    return (
      <div className="space-y-8 animate-in fade-in duration-500 max-w-2xl mx-auto py-16 px-4">
        <div className="text-center space-y-3">
          <div className="flex justify-center">
            <div className="rounded-full bg-blue-100 p-4">
              <Brain className="h-10 w-10 text-blue-600" />
            </div>
          </div>
          <h2 className="text-2xl font-bold">ML Dashboard isn't ready yet</h2>
          <p className="text-muted-foreground">
            Complete the steps below to train your first predictive maintenance model.
          </p>
        </div>

        <div className="space-y-3">
          {steps.map((step, i) => (
            <div
              key={i}
              className={`flex items-start gap-4 rounded-lg border p-4 ${
                step.done ? "bg-green-50 border-green-200" : "bg-card"
              }`}
            >
              <div className="mt-0.5 shrink-0">
                {step.done ? (
                  <CheckCircle2 className="h-5 w-5 text-green-600" />
                ) : (
                  <div className="h-5 w-5 rounded-full border-2 border-muted-foreground/40 flex items-center justify-center text-xs font-bold text-muted-foreground">
                    {i + 1}
                  </div>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className={`font-medium ${step.done ? "text-green-800" : ""}`}>{step.label}</p>
                <p className="text-sm text-muted-foreground mt-0.5">{step.detail}</p>
              </div>
              {!step.done && step.href && (
                <Link href={step.href}>
                  <a className="shrink-0 inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-colors">
                    {step.action}
                    <ArrowRight className="h-3 w-3" />
                  </a>
                </Link>
              )}
            </div>
          ))}
        </div>

        <p className="text-center text-xs text-muted-foreground">
          Once training completes this page will populate automatically.
        </p>
      </div>
    );
  }

  // Prepare confusion matrix data for visualization
  const confusionData = [
    {
      actual: "HIGH",
      predictedHIGH: modelMetrics.confusionMatrix.HIGH.predictedHIGH,
      predictedMEDIUM: modelMetrics.confusionMatrix.HIGH.predictedMEDIUM,
      predictedLOW: modelMetrics.confusionMatrix.HIGH.predictedLOW,
    },
    {
      actual: "MEDIUM",
      predictedHIGH: modelMetrics.confusionMatrix.MEDIUM.predictedHIGH,
      predictedMEDIUM: modelMetrics.confusionMatrix.MEDIUM.predictedMEDIUM,
      predictedLOW: modelMetrics.confusionMatrix.MEDIUM.predictedLOW,
    },
    {
      actual: "LOW",
      predictedHIGH: modelMetrics.confusionMatrix.LOW.predictedHIGH,
      predictedMEDIUM: modelMetrics.confusionMatrix.LOW.predictedMEDIUM,
      predictedLOW: modelMetrics.confusionMatrix.LOW.predictedLOW,
    },
  ];

  // Calculate overall metrics
  const avgPrecision = (
    (modelMetrics.precision.HIGH + modelMetrics.precision.MEDIUM + modelMetrics.precision.LOW) / 3
  ).toFixed(3);
  
  const avgRecall = (
    (modelMetrics.recall.HIGH + modelMetrics.recall.MEDIUM + modelMetrics.recall.LOW) / 3
  ).toFixed(3);

  const avgF1 = (
    (modelMetrics.f1Score.HIGH + modelMetrics.f1Score.MEDIUM + modelMetrics.f1Score.LOW) / 3
  ).toFixed(3);

  // Class performance data
  const classPerformance = [
    { class: "HIGH", precision: modelMetrics.precision.HIGH, recall: modelMetrics.recall.HIGH, f1: modelMetrics.f1Score.HIGH },
    { class: "MEDIUM", precision: modelMetrics.precision.MEDIUM, recall: modelMetrics.recall.MEDIUM, f1: modelMetrics.f1Score.MEDIUM },
    { class: "LOW", precision: modelMetrics.precision.LOW, recall: modelMetrics.recall.LOW, f1: modelMetrics.f1Score.LOW },
  ];

  // Dynamic insight values
  const lowPrecision  = (modelMetrics.precision.LOW   * 100).toFixed(0);
  const lowRecall     = (modelMetrics.recall.LOW       * 100).toFixed(0);
  const highRecall    = (modelMetrics.recall.HIGH      * 100).toFixed(0);
  const mediumRecall  = (modelMetrics.recall.MEDIUM    * 100).toFixed(0);
  const topFeature    = modelMetrics.featureImportance[0]?.feature ?? 'Equipment Age';
  const secondFeature = modelMetrics.featureImportance[1]?.feature ?? 'Usage Hours';
  const topTwo        = (
    (modelMetrics.featureImportance[0]?.importance ?? 0) +
    (modelMetrics.featureImportance[1]?.importance ?? 0)
  ) * 100;

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      {/* Header */}
      <div>
        <h2 className="text-3xl font-bold tracking-tight">ML Model Performance</h2>
        <p className="text-muted-foreground">
          Predictive maintenance model evaluation and monitoring
        </p>
      </div>

      {/* Model Status Alert */}
      <Alert className="border-green-200 bg-green-50">
        <CheckCircle2 className="h-4 w-4 text-green-600" />
        <AlertDescription className="text-green-800">
          <strong>Model Status: Production</strong> • Last updated {new Date(modelMetrics.trainedAt).toLocaleDateString()} • 
          Overall accuracy: {(modelMetrics.accuracy * 100).toFixed(1)}%
        </AlertDescription>
      </Alert>

      {/* Key Metrics Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card className="border-l-4 border-l-blue-500">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Overall Accuracy</CardTitle>
            <Target className="h-4 w-4 text-blue-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-blue-600">
              {(modelMetrics.accuracy * 100).toFixed(1)}%
            </div>
            <p className="text-xs text-muted-foreground">
              Correct predictions across all classes
            </p>
          </CardContent>
        </Card>

        <Card className="border-l-4 border-l-green-500">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Avg Precision</CardTitle>
            <TrendingUp className="h-4 w-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">
              {(parseFloat(avgPrecision) * 100).toFixed(1)}%
            </div>
            <p className="text-xs text-muted-foreground">
              Positive prediction accuracy
            </p>
          </CardContent>
        </Card>

        <Card className="border-l-4 border-l-purple-500">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Avg Recall</CardTitle>
            <Activity className="h-4 w-4 text-purple-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-purple-600">
              {(parseFloat(avgRecall) * 100).toFixed(1)}%
            </div>
            <p className="text-xs text-muted-foreground">
              Actual positive capture rate
            </p>
          </CardContent>
        </Card>

        <Card className="border-l-4 border-l-orange-500">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Avg F1 Score</CardTitle>
            <Zap className="h-4 w-4 text-orange-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-orange-600">
              {(parseFloat(avgF1) * 100).toFixed(1)}%
            </div>
            <p className="text-xs text-muted-foreground">
              Harmonic mean of precision & recall
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Charts Row 1: Feature Importance & Class Performance */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Feature Importance</CardTitle>
            <CardDescription>
              Which features drive failure predictions (higher = more influential)
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-[350px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={modelMetrics.featureImportance} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" horizontal={true} vertical={false} />
                  <XAxis type="number" domain={[0, 0.3]} tickFormatter={(value) => `${(value * 100).toFixed(0)}%`} />
                  <YAxis type="category" dataKey="feature" width={150} fontSize={12} />
                  <Tooltip
                    formatter={(value: number) => `${(value * 100).toFixed(1)}%`}
                    contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                  />
                  <Bar dataKey="importance" radius={[0, 4, 4, 0]}>
                    {modelMetrics.featureImportance.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={`hsl(${220 - index * 20}, 70%, 50%)`} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="mt-4 space-y-2 text-xs text-muted-foreground">
              {modelMetrics.featureImportance.slice(0, 3).map((feat, idx) => (
                <div key={idx}>
                  <strong>{feat.feature}:</strong> {feat.description}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Per-Class Performance</CardTitle>
            <CardDescription>
              Precision, recall, and F1 score by risk level
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-[350px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={classPerformance}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
                  <XAxis dataKey="class" />
                  <YAxis domain={[0, 1]} tickFormatter={(value) => `${(value * 100).toFixed(0)}%`} />
                  <Tooltip
                    formatter={(value: number) => `${(value * 100).toFixed(1)}%`}
                    contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                  />
                  <Legend />
                  <Bar dataKey="precision" fill="#3b82f6" name="Precision" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="recall" fill="#10b981" name="Recall" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="f1" fill="#8b5cf6" name="F1 Score" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="mt-4 grid grid-cols-3 gap-4 text-center text-xs">
              <div>
                <div className="font-medium">Precision</div>
                <div className="text-muted-foreground">Predicted positive accuracy</div>
              </div>
              <div>
                <div className="font-medium">Recall</div>
                <div className="text-muted-foreground">Actual positive capture</div>
              </div>
              <div>
                <div className="font-medium">F1 Score</div>
                <div className="text-muted-foreground">Balanced performance</div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Charts Row 2: Confusion Matrix & Prediction History */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Confusion Matrix</CardTitle>
            <CardDescription>
              Actual vs predicted classifications (test set)
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="overflow-hidden rounded-lg border">
                <table className="w-full">
                  <thead className="bg-slate-50">
                    <tr>
                      <th className="p-3 text-left text-xs font-medium text-muted-foreground">Actual \ Predicted</th>
                      <th className="p-3 text-center text-xs font-medium text-red-700">HIGH</th>
                      <th className="p-3 text-center text-xs font-medium text-orange-700">MEDIUM</th>
                      <th className="p-3 text-center text-xs font-medium text-green-700">LOW</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {confusionData.map((row, idx) => (
                      <tr key={idx}>
                        <td className={`p-3 text-sm font-medium ${
                          row.actual === 'HIGH' ? 'text-red-700' :
                          row.actual === 'MEDIUM' ? 'text-orange-700' :
                          'text-green-700'
                        }`}>
                          {row.actual}
                        </td>
                        <td className={`p-3 text-center text-sm font-bold ${row.actual === 'HIGH' ? 'bg-red-50' : ''}`}>
                          {row.predictedHIGH}
                        </td>
                        <td className={`p-3 text-center text-sm font-bold ${row.actual === 'MEDIUM' ? 'bg-orange-50' : ''}`}>
                          {row.predictedMEDIUM}
                        </td>
                        <td className={`p-3 text-center text-sm font-bold ${row.actual === 'LOW' ? 'bg-green-50' : ''}`}>
                          {row.predictedLOW}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="space-y-2 text-xs">
                <div className="flex items-start gap-2">
                  <CheckCircle2 className="h-4 w-4 text-green-600 mt-0.5" />
                  <div><strong>Diagonal values</strong> (highlighted) represent correct predictions</div>
                </div>
                <div className="flex items-start gap-2">
                  <AlertCircle className="h-4 w-4 text-orange-600 mt-0.5" />
                  <div><strong>Off-diagonal values</strong> show misclassifications - lower is better</div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Prediction Distribution Over Time</CardTitle>
            <CardDescription>
              Monthly breakdown of risk classifications
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-[280px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={modelMetrics.predictionHistory}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis dataKey="date" />
                  <YAxis />
                  <Tooltip
                    contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                  />
                  <Legend />
                  <Line type="monotone" dataKey="high" stroke="#ef4444" strokeWidth={2} name="High Risk" />
                  <Line type="monotone" dataKey="medium" stroke="#f97316" strokeWidth={2} name="Medium Risk" />
                  <Line type="monotone" dataKey="low" stroke="#22c55e" strokeWidth={2} name="Low Risk" />
                  <Line type="monotone" dataKey="total" stroke="#64748b" strokeWidth={2} strokeDasharray="5 5" name="Total" />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <div className="mt-4 text-xs text-muted-foreground">
              Shows the distribution of risk predictions across the fleet over time. 
              Trends can indicate seasonal patterns or fleet aging effects.
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Model Metadata */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Brain className="h-5 w-5 text-blue-600" />
              <CardTitle>Model Information</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <div className="flex justify-between items-center pb-3 border-b">
                <span className="text-sm text-muted-foreground">Model Version</span>
                <Badge variant="outline" className="bg-blue-50 text-blue-700">
                  {modelMetrics.version}
                </Badge>
              </div>
              <div className="flex justify-between items-center pb-3 border-b">
                <span className="text-sm text-muted-foreground">Algorithm</span>
                <span className="text-sm font-medium">{modelMetrics.hyperparameters.algorithm}</span>
              </div>
              <div className="flex justify-between items-center pb-3 border-b">
                <span className="text-sm text-muted-foreground">Training Date</span>
                <span className="text-sm font-medium">
                  {new Date(modelMetrics.trainedAt).toLocaleDateString()}
                </span>
              </div>
              <div className="flex justify-between items-center pb-3 border-b">
                <span className="text-sm text-muted-foreground">Training Dataset Size</span>
                <span className="text-sm font-medium">{modelMetrics.datasetSize.toLocaleString()} samples</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-muted-foreground">Status</span>
                <Badge className="bg-green-100 text-green-800 border-green-300">Production</Badge>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Database className="h-5 w-5 text-purple-600" />
              <CardTitle>Hyperparameters</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <div className="flex justify-between items-center pb-3 border-b">
                <span className="text-sm text-muted-foreground">Number of Estimators</span>
                <span className="text-sm font-mono font-medium">{modelMetrics.hyperparameters.nEstimators}</span>
              </div>
              <div className="flex justify-between items-center pb-3 border-b">
                <span className="text-sm text-muted-foreground">Max Depth</span>
                <span className="text-sm font-mono font-medium">{modelMetrics.hyperparameters.maxDepth}</span>
              </div>
              <div className="flex justify-between items-center pb-3 border-b">
                <span className="text-sm text-muted-foreground">Min Samples Split</span>
                <span className="text-sm font-mono font-medium">{modelMetrics.hyperparameters.minSamplesSplit}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-muted-foreground">Class Weight</span>
                <span className="text-sm font-mono font-medium">{modelMetrics.hyperparameters.classWeight}</span>
              </div>
            </div>
            <div className="mt-4 p-3 bg-slate-50 rounded-lg text-xs text-muted-foreground">
              <strong>Note:</strong> Class weights are balanced to handle imbalanced training data and 
              prevent bias toward majority classes.
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Drift Monitoring — three layers */}
      <div className="space-y-4">
        <h2 className="text-lg font-semibold text-slate-800">Drift Monitoring</h2>
        <DriftMonitorCard />
        <PredictionDriftCard />
        <BiasDriftCard />
      </div>

      {/* Model Governance */}
      <div className="space-y-4">
        <h2 className="text-lg font-semibold text-slate-800">Model Governance</h2>
        <DataQualityCard />
        <ChampionChallengerCard />
      </div>

      {/* Key Insights */}
      <Card className="border-blue-200 bg-blue-50">
        <CardHeader>
          <CardTitle className="text-blue-900">Key Model Insights</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-blue-900">
          {/* LOW risk */}
          <div className="flex items-start gap-2">
            {parseFloat(lowPrecision) >= 70 && parseFloat(lowRecall) >= 70
              ? <CheckCircle2 className="h-5 w-5 text-blue-600 mt-0.5 flex-shrink-0" />
              : <AlertCircle  className="h-5 w-5 text-orange-600 mt-0.5 flex-shrink-0" />
            }
            <div>
              <strong>LOW risk detection:</strong> {lowPrecision}% precision and {lowRecall}% recall.{" "}
              {parseFloat(lowPrecision) >= 70 && parseFloat(lowRecall) >= 70
                ? "Reliable identification of equipment in good condition, minimizing unnecessary maintenance."
                : parseFloat(lowRecall) < 30
                  ? "Low recall indicates the model may be collapsing to a single class — more labeled failure examples needed."
                  : "Precision or recall below target — consider advancing the simulation to generate more failure events."
              }
            </div>
          </div>
          {/* HIGH risk */}
          <div className="flex items-start gap-2">
            {parseFloat(highRecall) >= 70
              ? <CheckCircle2 className="h-5 w-5 text-blue-600 mt-0.5 flex-shrink-0" />
              : <AlertCircle  className="h-5 w-5 text-orange-600 mt-0.5 flex-shrink-0" />
            }
            <div>
              <strong>HIGH risk recall ({highRecall}%):</strong>{" "}
              {parseFloat(highRecall) >= 70
                ? "Model successfully catches most critical failure cases, crucial for safety and preventing downtime."
                : parseFloat(highRecall) === 0
                  ? "Model is not detecting HIGH risk units — training data has too few failure examples. Advance simulation and retrain."
                  : "Partial HIGH risk coverage. More failure events in training data will improve detection."
              }
            </div>
          </div>
          {/* MEDIUM risk */}
          <div className="flex items-start gap-2">
            {parseFloat(mediumRecall) >= 70
              ? <CheckCircle2 className="h-5 w-5 text-blue-600 mt-0.5 flex-shrink-0" />
              : <AlertCircle  className="h-5 w-5 text-orange-600 mt-0.5 flex-shrink-0" />
            }
            <div>
              <strong>MEDIUM risk recall ({mediumRecall}%):</strong>{" "}
              {parseFloat(mediumRecall) >= 70
                ? "Good coverage of medium-risk equipment across the fleet."
                : "MEDIUM risk units being misclassified — class imbalance likely. Advance simulation to generate more labeled samples."
              }
            </div>
          </div>
          {/* Top features */}
          <div className="flex items-start gap-2">
            <TrendingUp className="h-5 w-5 text-blue-600 mt-0.5 flex-shrink-0" />
            <div>
              <strong>Top predictive features:</strong> {topFeature} and {secondFeature} contribute{" "}
              {topTwo.toFixed(0)}% of prediction power, validating the importance of these maintenance factors.
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}