import { useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import {
  useFleetRisk,
  useRunPredictions,
  useGenerateSnapshots,
  useLabelSnapshots,
  usePipelineStatus,
  useSimulationState,
  useSimulateDay,
} from "@/hooks/use-predictive-maintenance";
import { useEquipment } from "@/hooks/use-equipment";
import { useMultiHorizonRiskScores, useLatestMultiHorizonPredictions } from "@/hooks/use-risk-score";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  AlertTriangle,
  CheckCircle,
  TrendingUp,
  TrendingDown,
  Minus,
  Activity,
  Loader2,
  Play,
  Database,
  Tag,
  Info,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

// ─── Types ────────────────────────────────────────────────────────────────────

type RiskLevel = "LOW" | "MEDIUM" | "HIGH";
type Horizon = "10d" | "30d" | "60d";
type RiskTrend = "INCREASING" | "DECREASING" | "STABLE";

interface HorizonPrediction {
  failure_probability: number;
  risk_level: RiskLevel;
  risk_score: number;
  model_confidence: string;
  top_risk_drivers: Record<string, number>;
}

interface MultiHorizonResult {
  equipmentId: number;
  modelVersion: string;
  riskTrend: RiskTrend;
  predictions: Record<Horizon, HorizonPrediction>;
  recommendation: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const HORIZON_LABELS: Record<Horizon, string> = {
  "10d": "Next 10 Days",
  "30d": "Next 30 Days",
  "60d": "Next 60 Days",
};

const HORIZON_CONFIDENCE: Record<Horizon, string> = {
  "10d": "Moderate confidence",
  "30d": "High confidence",
  "60d": "Very high confidence",
};

const RISK_COLORS: Record<RiskLevel, string> = {
  HIGH:   "bg-red-100 text-red-800 border-red-300",
  MEDIUM: "bg-orange-100 text-orange-800 border-orange-300",
  LOW:    "bg-green-100 text-green-800 border-green-300",
};

const RISK_ROW_COLORS: Record<RiskLevel, string> = {
  HIGH:   "border-red-200 bg-red-50",
  MEDIUM: "border-orange-200 bg-orange-50",
  LOW:    "border-green-200 bg-green-50",
};

function TrendIcon({ trend }: { trend: RiskTrend }) {
  if (trend === "INCREASING") return <TrendingUp className="h-4 w-4 text-red-500" />;
  if (trend === "DECREASING") return <TrendingDown className="h-4 w-4 text-green-500" />;
  return <Minus className="h-4 w-4 text-slate-400" />;
}

function RiskBadge({ level }: { level: RiskLevel }) {
  return (
    <Badge variant="outline" className={RISK_COLORS[level]}>
      {level}
    </Badge>
  );
}

// ─── Horizon Selector ─────────────────────────────────────────────────────────

function HorizonSelector({ selected, onChange }: { selected: Horizon; onChange: (h: Horizon) => void }) {
  return (
    <div className="flex gap-1 p-1 bg-slate-100 rounded-lg">
      {(["10d", "30d", "60d"] as Horizon[]).map((h) => (
        <button
          key={h}
          onClick={() => onChange(h)}
          className={cn(
            "px-4 py-1.5 rounded-md text-sm font-medium transition-all",
            selected === h
              ? "bg-white shadow-sm text-slate-900"
              : "text-slate-600 hover:text-slate-900"
          )}
        >
          {h}
        </button>
      ))}
    </div>
  );
}

// ─── Pipeline Status ──────────────────────────────────────────────────────────

function PipelineStatusCard() {
  const { data: status } = usePipelineStatus();
  if (!status) return null;

  return (
    <Card className="border-blue-200">
      <CardHeader>
        <CardTitle>Pipeline Status</CardTitle>
        <CardDescription>ML pipeline data readiness</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <div className="text-sm text-muted-foreground">Feature Snapshots</div>
            <div className="text-2xl font-bold">{status.snapshots.total}</div>
            <div className="text-xs text-muted-foreground">
              {status.snapshots.labeled} labeled, {status.snapshots.unlabeled} unlabeled
            </div>
          </div>
          <div>
            <div className="text-sm text-muted-foreground">Models Active</div>
            <div className="text-2xl font-bold">3</div>
            <div className="text-xs text-muted-foreground">
              10d · 30d · 60d horizons ({status.modelStatus ?? 'ml'})
            </div>
          </div>
        </div>

        {status.readyForTraining ? (
          <Alert className="border-green-200 bg-green-50">
            <CheckCircle className="h-4 w-4 text-green-600" />
            <AlertDescription className="text-green-800">
              <strong>Ready for ML training!</strong> {status.snapshots.labeled} labeled samples across all horizons.
            </AlertDescription>
          </Alert>
        ) : (
          <Alert>
            <AlertDescription>
              Need {100 - status.snapshots.labeled} more labeled samples for ML training.
            </AlertDescription>
          </Alert>
        )}

        {status.snapshots.oldestDate && (
          <div className="text-xs text-muted-foreground">
            Data range: {new Date(status.snapshots.oldestDate).toLocaleDateString()} to{" "}
            {new Date(status.snapshots.newestDate).toLocaleDateString()}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function PredictiveMaintenanceDashboard() {
  const { user } = useAuth();
  const simulationState = useSimulationState();
  const simulateDay = useSimulateDay();
  const [simDays, setSimDays] = useState(1);
  const [selectedHorizon, setSelectedHorizon] = useState<Horizon>("30d");
  const [selectedResult, setSelectedResult] = useState<MultiHorizonResult & { name: string; equipmentCode: string; category: string } | null>(null);

  const { data: fleetRisk } = useFleetRisk();
  const { data: equipment } = useEquipment();
  const runPredictions = useRunPredictions();
  const generateSnapshots = useGenerateSnapshots();
  const labelSnapshots = useLabelSnapshots();
  const { data: pipelineStatus } = usePipelineStatus();

  const { scores, mutation: mhMutation } = useMultiHorizonRiskScores();
  const { data: latestPredictions } = useLatestMultiHorizonPredictions();

  const isAdmin = user?.role === "ADMINISTRATOR";

  // Merge multi-horizon results with equipment names
  const resultsWithNames: Array<MultiHorizonResult & { name: string; equipmentCode: string; category: string; status: string }> = (
    scores.length > 0 ? scores : latestPredictions ?? []
  ).map((result: any) => {
    const equip = equipment?.find((e) => e.id === (result.equipmentId ?? result.equipment_id));
    return {
      ...result,
      equipmentId: result.equipmentId ?? result.equipment_id,
      name:          equip?.name ?? result.name ?? `Equipment ${result.equipmentId ?? result.equipment_id}`,
      equipmentCode: equip?.equipmentId ?? result.equipment_code ?? "",
      category:      equip?.category ?? result.category ?? "",
      status:        equip?.status ?? result.status ?? "",
      // Handle DB rows vs fresh API results
      predictions: result.predictions ?? {
        "10d": { failure_probability: Number(result.prob_10d), risk_level: result.risk_level_10d, risk_score: Math.round(Number(result.prob_10d) * 100), model_confidence: "moderate", top_risk_drivers: (() => { try { const d = JSON.parse(result.top_drivers_10d || "[]"); return Array.isArray(d) ? Object.fromEntries(d.map((k: string) => [k, 0.05])) : d; } catch { return {}; } })() },
        "30d": { failure_probability: Number(result.prob_30d), risk_level: result.risk_level_30d, risk_score: Math.round(Number(result.prob_30d) * 100), model_confidence: "high",     top_risk_drivers: (() => { try { const d = JSON.parse(result.top_drivers_30d || "[]"); return Array.isArray(d) ? Object.fromEntries(d.map((k: string) => [k, 0.05])) : d; } catch { return {}; } })() },
        "60d": { failure_probability: Number(result.prob_60d), risk_level: result.risk_level_60d, risk_score: Math.round(Number(result.prob_60d) * 100), model_confidence: "very high", top_risk_drivers: (() => { try { const d = JSON.parse(result.top_drivers_60d || "[]"); return Array.isArray(d) ? Object.fromEntries(d.map((k: string) => [k, 0.05])) : d; } catch { return {}; } })() },
      },
    };
  });
  
  // Sort by selected horizon failure probability descending
  const sortedResults = [...resultsWithNames].sort(
    (a, b) =>
      (b.predictions?.[selectedHorizon]?.failure_probability ?? 0) -
      (a.predictions?.[selectedHorizon]?.failure_probability ?? 0)
  );

  // Fleet distribution for selected horizon
  const horizonDistribution = sortedResults.reduce(
    (acc, r) => {
      const level = r.predictions?.[selectedHorizon]?.risk_level ?? "LOW";
      acc[level] = (acc[level] ?? 0) + 1;
      return acc;
    },
    { HIGH: 0, MEDIUM: 0, LOW: 0 } as Record<RiskLevel, number>
  );

  const total = sortedResults.length;
  const highRiskCount = horizonDistribution.HIGH;

  const handleRunMultiHorizon = () => {
    if (!equipment) return;
    mhMutation.mutate(equipment.map((e) => e.id));
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      {/* Header */}
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Predictive Maintenance</h2>
          <p className="text-muted-foreground">
            Multi-horizon failure probability — 10, 30, and 60 day windows
          </p>
        </div>

        <div className="flex gap-2">
          <Button
            onClick={handleRunMultiHorizon}
            disabled={mhMutation.isPending}
            className="gap-2"
          >
            {mhMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Play className="h-4 w-4" />
            )}
            Run Predictions
          </Button>
        </div>
      </div>

      {/* High risk alert */}
      {highRiskCount > 0 && (
        <Alert className="border-red-200 bg-red-50">
          <AlertTriangle className="h-4 w-4 text-red-600" />
          <AlertDescription className="text-red-800">
            <strong>{highRiskCount} equipment item{highRiskCount !== 1 ? "s" : ""}</strong> predicted HIGH RISK within{" "}
            {HORIZON_LABELS[selectedHorizon].toLowerCase()} — immediate maintenance recommended
          </AlertDescription>
        </Alert>
      )}

      {/* Model confidence note */}
      <Alert className="border-blue-100 bg-blue-50">
        <Info className="h-4 w-4 text-blue-600" />
        <AlertDescription className="text-blue-800 text-sm">
          Predictions use three separate Random Forest models trained on 12,620 labeled snapshots.
          <span className="ml-1 font-medium">
            10d: moderate confidence · 30d: high · 60d: very high
            {pipelineStatus?.modelStatus && (
              <span className="ml-1 text-blue-600">· {pipelineStatus.modelStatus}</span>
            )}
          </span>
        </AlertDescription>
      </Alert>

      {/* Pipeline Status */}
      <PipelineStatusCard />

      {/* Horizon selector + fleet distribution */}
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <div className="text-sm text-muted-foreground mb-1">Prediction Window</div>
          <HorizonSelector selected={selectedHorizon} onChange={setSelectedHorizon} />
        </div>

        <div className="flex gap-4 text-sm">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-red-500" />
            <span className="text-muted-foreground">High: <strong>{horizonDistribution.HIGH}</strong></span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-orange-400" />
            <span className="text-muted-foreground">Medium: <strong>{horizonDistribution.MEDIUM}</strong></span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-green-500" />
            <span className="text-muted-foreground">Low: <strong>{horizonDistribution.LOW}</strong></span>
          </div>
        </div>
      </div>

      {/* Equipment predictions table */}
      <Card>
        <CardHeader>
          <CardTitle>Fleet Failure Predictions — {HORIZON_LABELS[selectedHorizon]}</CardTitle>
          <CardDescription>
            {HORIZON_CONFIDENCE[selectedHorizon]} · Sorted by failure probability · Click for full horizon breakdown
          </CardDescription>
        </CardHeader>
        <CardContent>
          {sortedResults.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              No predictions yet. Click <strong>Run Predictions</strong> to generate multi-horizon forecasts.
            </div>
          ) : (
            <div className="space-y-2">
              {sortedResults.map((result) => {
                const pred = result.predictions?.[selectedHorizon];
                if (!pred) return null;
                const riskLevel = pred.risk_level;

                return (
                  <div
                    key={result.equipmentId}
                    onClick={() => setSelectedResult(result)}
                    className={cn(
                      "flex items-center justify-between p-4 rounded-lg border cursor-pointer transition-all",
                      "hover:shadow-sm",
                      RISK_ROW_COLORS[riskLevel]
                    )}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate">{result.name}</div>
                      <div className="text-sm text-muted-foreground">
                        {result.category} · {result.equipmentCode}
                      </div>
                    </div>

                    {/* Horizon probability bars */}
                    <div className="hidden md:flex items-center gap-6 mx-6">
                      {(["10d", "30d", "60d"] as Horizon[]).map((h) => {
                        const p = result.predictions?.[h];
                        if (!p) return null;
                        return (
                          <TooltipProvider key={h}>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <div className="flex flex-col items-center gap-1 w-14">
                                  <div className="text-xs text-muted-foreground">{h}</div>
                                  <div className="w-full h-1.5 bg-slate-200 rounded-full overflow-hidden">
                                    <div
                                      className={cn(
                                        "h-full rounded-full",
                                        p.risk_level === "HIGH"   && "bg-red-500",
                                        p.risk_level === "MEDIUM" && "bg-orange-400",
                                        p.risk_level === "LOW"    && "bg-green-500"
                                      )}
                                      style={{ width: `${Math.round(p.failure_probability * 100)}%` }}
                                    />
                                  </div>
                                  <div className="text-xs font-medium">
                                    {Math.round(p.failure_probability * 100)}%
                                  </div>
                                </div>
                              </TooltipTrigger>
                              <TooltipContent>
                                <p>{h}: {p.risk_level} ({Math.round(p.failure_probability * 100)}% failure probability)</p>
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        );
                      })}
                    </div>

                    <div className="flex items-center gap-3">
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <div className="flex items-center gap-1">
                              <TrendIcon trend={result.riskTrend ?? "STABLE"} />
                            </div>
                          </TooltipTrigger>
                          <TooltipContent>
                            <p>Risk trend: {result.riskTrend ?? "STABLE"}</p>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                      <RiskBadge level={riskLevel} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Admin Controls */}
      {isAdmin && (
        <Card>
          <CardHeader>
            <CardTitle>ML Pipeline Controls</CardTitle>
            <CardDescription>Administrative controls for the predictive maintenance pipeline</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-start gap-4 p-4 border rounded-lg">
              <Database className="h-5 w-5 text-blue-600 mt-0.5" />
              <div className="flex-1">
                <div className="font-medium">Generate Feature Snapshots</div>
                <div className="text-sm text-muted-foreground">
                  Extract features from operational data for model training
                </div>
              </div>
              <Button variant="outline" onClick={() => generateSnapshots.mutate(undefined)} disabled={generateSnapshots.isPending}>
                {generateSnapshots.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Database className="mr-2 h-4 w-4" />}
                Generate
              </Button>
            </div>

            <div className="flex items-start gap-4 p-4 border rounded-lg">
              <Tag className="h-5 w-5 text-purple-600 mt-0.5" />
              <div className="flex-1">
                <div className="font-medium">Label Historical Data</div>
                <div className="text-sm text-muted-foreground">
                  Label snapshots with 10d/30d/60d failure outcomes for model training
                </div>
              </div>
              <Button variant="outline" onClick={() => labelSnapshots.mutate(undefined)} disabled={labelSnapshots.isPending}>
                {labelSnapshots.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Tag className="mr-2 h-4 w-4" />}
                Label
              </Button>
            </div>

            <div className="flex items-start gap-4 p-4 border rounded-lg bg-slate-50">
              <Activity className="h-5 w-5 text-green-600 mt-0.5" />
              <div className="flex-1">
                <div className="font-medium">Simulate Operations</div>
                <div className="text-sm text-muted-foreground mb-3">
                  Generate sensor readings and maintenance events.
                  {(() => {
                    const s = simulationState.data as any;
                    if (!s) return null;
                    return (
                      <span className="ml-1 text-xs">
                        Cursor: <strong>{s.cursor_date}</strong> · {s.total_days_run} days run
                      </span>
                    );
                  })()}
                </div>
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-muted-foreground">Days:</span>
                    <input
                      type="range" min={1} max={30} value={simDays}
                      onChange={(e) => setSimDays(parseInt(e.target.value))}
                      className="w-24"
                    />
                    <span className="text-sm font-medium w-6">{simDays}</span>
                  </div>
                  <Button
                    variant="outline" size="sm"
                    onClick={() => simulateDay.mutate(simDays)}
                    disabled={simulateDay.isPending}
                    className="border-green-300 text-green-700 hover:bg-green-50"
                  >
                    {simulateDay.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}
                    Simulate {simDays} Day{simDays > 1 ? "s" : ""}
                  </Button>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Detail Modal — full horizon breakdown */}
      {selectedResult && (
        <Dialog open={!!selectedResult} onOpenChange={() => setSelectedResult(null)}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                {selectedResult.name}
                <TrendIcon trend={selectedResult.riskTrend ?? "STABLE"} />
              </DialogTitle>
              <DialogDescription>
                {selectedResult.category} · {selectedResult.equipmentCode} ·{" "}
                <span className={cn(
                  "font-medium",
                  selectedResult.riskTrend === "INCREASING" && "text-red-600",
                  selectedResult.riskTrend === "DECREASING" && "text-green-600",
                  selectedResult.riskTrend === "STABLE"     && "text-slate-600",
                )}>
                  Risk {selectedResult.riskTrend?.toLowerCase() ?? "stable"} across horizons
                </span>
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-6">
              {/* Three horizon cards */}
              <div className="grid grid-cols-3 gap-3">
                {(["10d", "30d", "60d"] as Horizon[]).map((h) => {
                  const pred = selectedResult.predictions?.[h];
                  if (!pred) return null;
                  return (
                    <div
                      key={h}
                      className={cn(
                        "p-4 rounded-lg border-2 text-center",
                        pred.risk_level === "HIGH"   && "border-red-300 bg-red-50",
                        pred.risk_level === "MEDIUM" && "border-orange-300 bg-orange-50",
                        pred.risk_level === "LOW"    && "border-green-300 bg-green-50",
                      )}
                    >
                      <div className="text-xs text-muted-foreground mb-1">{HORIZON_LABELS[h]}</div>
                      <div className="text-3xl font-bold mb-1">
                        {Math.round(pred.failure_probability * 100)}%
                      </div>
                      <RiskBadge level={pred.risk_level} />
                      <div className="text-xs text-muted-foreground mt-2">
                        {pred.model_confidence} confidence
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Recommendation */}
              <Alert>
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>
                  <strong>Recommendation:</strong> {selectedResult.recommendation}
                </AlertDescription>
              </Alert>

              {/* Risk drivers per horizon */}
              <div className="space-y-4">
                <h3 className="font-semibold">Key Risk Drivers by Horizon</h3>
                {(["10d", "30d", "60d"] as Horizon[]).map((h) => {
                  const pred = selectedResult.predictions?.[h];
                  const drivers = pred?.top_risk_drivers ?? {};
                  const driverKeys = Array.isArray(drivers) ? drivers : Object.keys(drivers);
                  if (driverKeys.length === 0) return null;
                  return (
                    <div key={h}>
                      <div className="text-sm font-medium text-muted-foreground mb-2">
                        {HORIZON_LABELS[h]}
                      </div>
                      <div className="space-y-1">
                        {driverKeys.slice(0, 3).map((driver: string, idx: number) => (
                          <div key={idx} className="flex items-center gap-2 text-sm">
                            <div className={cn(
                              "w-2 h-2 rounded-full flex-shrink-0",
                              pred?.risk_level === "HIGH"   && "bg-red-500",
                              pred?.risk_level === "MEDIUM" && "bg-orange-400",
                              pred?.risk_level === "LOW"    && "bg-green-500",
                            )} />
                            {driver}
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="pt-2 border-t text-xs text-muted-foreground">
                Model version: {selectedResult.modelVersion} · Multi-horizon Random Forest (calibrated)
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}