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
import { useEquipmentProjection, type ProjectionPoint, type ProjectionResult } from "@/hooks/use-predictive-maintenance";
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
  Wrench,
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
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  ReferenceLine,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
} from "recharts";
import { computeOptimalIntervention } from "@/lib/cost-model";
import { useTrainModel, useTrainingStatus } from "@/hooks/use-predictive-maintenance";
import { BrainCircuit, ScrollText } from "lucide-react";
import { MaintenanceForm } from "@/components/maintenance-form";

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

// ─── Projection Sparkline ─────────────────────────────────────────────────────
function ProjectionSparkline({ equipmentId }: { equipmentId: number }) {
  const { data, isLoading, isError } = useEquipmentProjection(equipmentId);

  if (isLoading) return (
    <div className="flex items-center justify-center h-24 text-muted-foreground text-sm">
      <Loader2 className="h-4 w-4 animate-spin mr-2" /> Loading trajectory...
    </div>
  );

  if (isError || !data) return null;

  const crossingDay = data.days_until_high;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">60-Day Failure Trajectory</span>
        {crossingDay !== null ? (
          crossingDay === 0 ? (
            <span className="text-xs font-medium text-red-600 bg-red-50 border border-red-200 px-2 py-0.5 rounded-full">
              Already HIGH risk
            </span>
          ) : (
            <span className="text-xs font-medium text-orange-600 bg-orange-50 border border-orange-200 px-2 py-0.5 rounded-full">
              Crosses HIGH in {crossingDay}d
            </span>
          )
        ) : (
          <span className="text-xs font-medium text-green-600 bg-green-50 border border-green-200 px-2 py-0.5 rounded-full">
            Stays below HIGH threshold
          </span>
        )}
      </div>

      <ResponsiveContainer width="100%" height={120}>
        <LineChart data={data.curve} margin={{ top: 4, right: 4, bottom: 4, left: -20 }}>
          <XAxis dataKey="day" tickLine={false} axisLine={false} tick={{ fontSize: 10 }} tickFormatter={(v) => `${v}d`} />
          <YAxis domain={[0, 1]} tickLine={false} axisLine={false} tick={{ fontSize: 10 }} tickFormatter={(v) => `${Math.round(v * 100)}%`} />
          <RechartsTooltip
            formatter={(value: number, name: string) => [`${Math.round(value * 100)}%`, name]}
            labelFormatter={(label) => `Day ${label}`}
          />
          <ReferenceLine y={0.60} stroke="#ef4444" strokeDasharray="3 3" strokeWidth={1} />
          <Line type="monotone" dataKey="10d" stroke="#f97316" strokeWidth={1.5} dot={false} name="10d" />
          <Line type="monotone" dataKey="30d" stroke="#8b5cf6" strokeWidth={1.5} dot={false} name="30d" />
          <Line type="monotone" dataKey="60d" stroke="#3b82f6" strokeWidth={2} dot={false} name="60d" />
        </LineChart>
      </ResponsiveContainer>

      <div className="flex gap-4 text-xs text-muted-foreground justify-center">
        <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-orange-400 inline-block"/>10d</span>
        <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-violet-500 inline-block"/>30d</span>
        <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-blue-500 inline-block"/>60d</span>
        <span className="flex items-center gap-1"><span className="w-3 h-0.5 border-t border-dashed border-red-400 inline-block"/>HIGH threshold</span>
      </div>
    </div>
  );
}

// ─── Cost Model Callout ───────────────────────────────────────────────────────
function CostCallout({
  equipmentId,
  dailyRate,
  category,
}: {
  equipmentId: number;
  dailyRate: number;
  category: string;
}) {
  const { data, isLoading } = useEquipmentProjection(equipmentId);

  if (isLoading || !data) return null;

  const result = computeOptimalIntervention(data.curve, dailyRate, category);

  if (result.optimalDay === null && !result.alreadyHighRisk) {
    return (
      <div className="flex items-center gap-2 text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2">
        <CheckCircle className="h-4 w-4 flex-shrink-0" />
        <span>
          Expected failure cost stays below PM cost for 60 days.{" "}
          <span className="font-medium">No urgent intervention needed.</span>
        </span>
      </div>
    );
  }

  if (result.alreadyHighRisk && result.optimalDay === 0) {
    return (
      <div className="flex items-center gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
        <AlertTriangle className="h-4 w-4 flex-shrink-0" />
        <span>
          Expected failure cost{" "}
          <span className="font-medium">${result.failureCostAtOptimal.toLocaleString()}</span>{" "}
          already exceeds PM cost{" "}
          <span className="font-medium">${result.pmCost.toLocaleString()}</span>.{" "}
          Schedule maintenance <span className="font-medium">immediately</span> — saves ~$
          {result.expectedSavings.toLocaleString()}.
        </span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 text-sm text-orange-700 bg-orange-50 border border-orange-200 rounded-lg px-3 py-2">
      <AlertTriangle className="h-4 w-4 flex-shrink-0" />
      <span>
        Schedule PM by{" "}
        <span className="font-medium">Day {result.optimalDay}</span> — saves ~$
        <span className="font-medium">{result.expectedSavings.toLocaleString()}</span> vs.
        unplanned failure (PM: ${result.pmCost.toLocaleString()} · Est. failure cost: $
        {result.failureCostAtOptimal.toLocaleString()})
      </span>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function PredictiveMaintenanceDashboard() {
  const { user } = useAuth();
  const simulationState = useSimulationState();
  const simulateDay = useSimulateDay();
  const queryClient = useQueryClient();
  const [simDays, setSimDays] = useState(1);
  const [selectedHorizon, setSelectedHorizon] = useState<Horizon>("30d");
  const [selectedResult, setSelectedResult] = useState<MultiHorizonResult & { name: string; equipmentCode: string; category: string } | null>(null);

  // ── Schedule PM dialog state ───────────────────────────────────────────────
  const [showSchedulePM, setShowSchedulePM] = useState(false);

  const trainModel = useTrainModel();
  const [showTrainLog, setShowTrainLog] = useState(false);
  const { data: trainStatus } = useTrainingStatus(trainModel.isPending || showTrainLog);

  const { data: fleetRisk } = useFleetRisk();
  const { data: equipment } = useEquipment();
  const runPredictions = useRunPredictions();
  const generateSnapshots = useGenerateSnapshots();
  const labelSnapshots = useLabelSnapshots();
  const { data: pipelineStatus } = usePipelineStatus();

  const { scores, mutation: mhMutation } = useMultiHorizonRiskScores();
  const { data: latestPredictions } = useLatestMultiHorizonPredictions();

  const isAdmin = user?.role === "ADMINISTRATOR";

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
      predictions: result.predictions ?? {
        "10d": { failure_probability: Number(result.prob_10d), risk_level: result.risk_level_10d, risk_score: Math.round(Number(result.prob_10d) * 100), model_confidence: "moderate", top_risk_drivers: (() => { try { const d = JSON.parse(result.top_drivers_10d || "[]"); return Array.isArray(d) ? Object.fromEntries(d.map((k: string) => [k, 0.05])) : d; } catch { return {}; } })() },
        "30d": { failure_probability: Number(result.prob_30d), risk_level: result.risk_level_30d, risk_score: Math.round(Number(result.prob_30d) * 100), model_confidence: "high",     top_risk_drivers: (() => { try { const d = JSON.parse(result.top_drivers_30d || "[]"); return Array.isArray(d) ? Object.fromEntries(d.map((k: string) => [k, 0.05])) : d; } catch { return {}; } })() },
        "60d": { failure_probability: Number(result.prob_60d), risk_level: result.risk_level_60d, risk_score: Math.round(Number(result.prob_60d) * 100), model_confidence: "very high", top_risk_drivers: (() => { try { const d = JSON.parse(result.top_drivers_60d || "[]"); return Array.isArray(d) ? Object.fromEntries(d.map((k: string) => [k, 0.05])) : d; } catch { return {}; } })() },
      },
    };
  });

  const sortedResults = [...resultsWithNames].sort(
    (a, b) =>
      (b.predictions?.[selectedHorizon]?.failure_probability ?? 0) -
      (a.predictions?.[selectedHorizon]?.failure_probability ?? 0)
  );

  const horizonDistribution = sortedResults.reduce(
    (acc, r) => {
      const level = r.predictions?.[selectedHorizon]?.risk_level ?? "LOW";
      acc[level] = (acc[level] ?? 0) + 1;
      return acc;
    },
    { HIGH: 0, MEDIUM: 0, LOW: 0 } as Record<RiskLevel, number>
  );

  const highRiskCount = horizonDistribution.HIGH;

  const handleRunMultiHorizon = () => {
    if (!equipment) return;
    mhMutation.mutate(equipment.map((e) => e.id));
  };

  // Determine overall risk level for selected unit (worst across horizons)
  const selectedRiskLevel = selectedResult
    ? (["HIGH", "MEDIUM", "LOW"] as RiskLevel[]).find(
        level => Object.values(selectedResult.predictions ?? {}).some(
          (p: any) => p.risk_level === level
        )
      ) ?? "LOW"
    : "LOW";

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
          <Button onClick={handleRunMultiHorizon} disabled={mhMutation.isPending} className="gap-2">
            {mhMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
            Run Predictions
          </Button>
        </div>
      </div>

      {highRiskCount > 0 && (
        <Alert className="border-red-200 bg-red-50">
          <AlertTriangle className="h-4 w-4 text-red-600" />
          <AlertDescription className="text-red-800">
            <strong>{highRiskCount} equipment item{highRiskCount !== 1 ? "s" : ""}</strong> predicted HIGH RISK within{" "}
            {HORIZON_LABELS[selectedHorizon].toLowerCase()} — immediate maintenance recommended
          </AlertDescription>
        </Alert>
      )}

      <Alert className="border-blue-100 bg-blue-50">
        <Info className="h-4 w-4 text-blue-600" />
        <AlertDescription className="text-blue-800 text-sm">
          Predictions use three separate Random Forest models trained on 22,025 labeled snapshots.
          <span className="ml-1 font-medium">
            10d: high confidence · 30d: high · 60d: high
            {pipelineStatus?.modelStatus && (
              <span className="ml-1 text-blue-600">· {pipelineStatus.modelStatus}</span>
            )}
          </span>
        </AlertDescription>
      </Alert>

      <PipelineStatusCard />

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
                      "flex items-center justify-between p-4 rounded-lg border cursor-pointer transition-all hover:shadow-sm",
                      RISK_ROW_COLORS[riskLevel]
                    )}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate">{result.name}</div>
                      <div className="text-sm text-muted-foreground">
                        {result.category} · {result.equipmentCode}
                      </div>
                    </div>

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

            <div className="flex items-start gap-4 p-4 border rounded-lg">
              <BrainCircuit className="h-5 w-5 text-indigo-600 mt-0.5" />
              <div className="flex-1">
                <div className="font-medium">Retrain Models</div>
                <div className="text-sm text-muted-foreground mb-2">
                  Train new models on all labeled snapshots. Takes 2–5 minutes. Models hot-swap on completion.
                </div>

                {trainStatus?.running && (
                  <div className="mb-2 p-2 bg-indigo-50 border border-indigo-200 rounded text-xs font-mono text-indigo-800 max-h-32 overflow-y-auto space-y-0.5">
                    {trainStatus.log.slice(-12).map((line, i) => (
                      <div key={i}>{line}</div>
                    ))}
                  </div>
                )}

                {trainStatus?.last_result && !trainStatus.running && (
                  <div className={cn(
                    "mb-2 flex items-center gap-2 text-xs px-2 py-1 rounded border",
                    trainStatus.last_result.success
                      ? "bg-green-50 border-green-200 text-green-700"
                      : "bg-red-50 border-red-200 text-red-700"
                  )}>
                    {trainStatus.last_result.success ? (
                      <><CheckCircle className="h-3 w-3" /> Training complete — {trainStatus.last_result.version} active</>
                    ) : (
                      <><AlertTriangle className="h-3 w-3" /> Training failed — check logs</>
                    )}
                  </div>
                )}

                {!trainStatus?.running && (trainStatus?.log?.length ?? 0) > 0 && (
                  <button
                    type="button"
                    onClick={() => setShowTrainLog(v => !v)}
                    className="text-xs text-indigo-600 underline mb-2"
                  >
                    <ScrollText className="h-3 w-3 inline mr-1" />
                    {showTrainLog ? "Hide" : "Show"} full log
                  </button>
                )}

                {showTrainLog && trainStatus?.log && (
                  <div className="mb-2 p-2 bg-slate-50 border rounded text-xs font-mono max-h-48 overflow-y-auto space-y-0.5">
                    {trainStatus.log.map((line, i) => (
                      <div key={i} className={cn(
                        line.includes("SUCCESS") && "text-green-700 font-semibold",
                        (line.includes("FATAL") || line.includes("FAILED")) && "text-red-700 font-semibold",
                        line.includes("[CV]") && "text-blue-700",
                        line.includes("[HOLDOUT]") && "text-purple-700",
                      )}>{line}</div>
                    ))}
                  </div>
                )}
              </div>
              <Button
                variant="outline"
                onClick={() => { setShowTrainLog(true); trainModel.mutate(); }}
                disabled={trainModel.isPending || trainStatus?.running}
                className="border-indigo-300 text-indigo-700 hover:bg-indigo-50"
              >
                {trainModel.isPending || trainStatus?.running
                  ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Training...</>
                  : <><BrainCircuit className="mr-2 h-4 w-4" /> Retrain</>
                }
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

      {/* ── Detail Modal ──────────────────────────────────────────────────────── */}
      {selectedResult && (
        <Dialog open={!!selectedResult} onOpenChange={(open) => {
          if (!open) {
            setSelectedResult(null);
            setShowSchedulePM(false);
          }
        }}>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
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

              {/* Risk drivers */}
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

              {/* Trajectory + cost */}
              <div className="pt-2 border-t space-y-3">
                <ProjectionSparkline equipmentId={selectedResult.equipmentId} />
                <CostCallout
                  equipmentId={selectedResult.equipmentId}
                  dailyRate={
                    equipment?.find((e) => e.id === selectedResult.equipmentId)?.dailyRate
                      ? Number(equipment.find((e) => e.id === selectedResult.equipmentId)!.dailyRate)
                      : 250
                  }
                  category={selectedResult.category}
                />
              </div>

              {/* ── Schedule PM button + inline form ──────────────────────── */}
              <div className="pt-2 border-t">
                {!showSchedulePM ? (
                  <Button
                    onClick={() => setShowSchedulePM(true)}
                    className={cn(
                      "w-full gap-2",
                      selectedRiskLevel === "HIGH" && "bg-red-600 hover:bg-red-700 text-white",
                      selectedRiskLevel === "MEDIUM" && "bg-orange-500 hover:bg-orange-600 text-white",
                      selectedRiskLevel === "LOW" && "variant-outline",
                    )}
                    variant={selectedRiskLevel === "LOW" ? "outline" : "default"}
                  >
                    <Wrench className="h-4 w-4" />
                    {selectedRiskLevel === "HIGH"
                      ? "Schedule Immediate PM"
                      : selectedRiskLevel === "MEDIUM"
                      ? "Schedule Preventive PM"
                      : "Log Maintenance Event"}
                  </Button>
                ) : (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <h4 className="text-sm font-semibold flex items-center gap-2">
                        <Wrench className="h-4 w-4" />
                        Log Maintenance Event
                      </h4>
                      <button
                        type="button"
                        onClick={() => setShowSchedulePM(false)}
                        className="text-xs text-muted-foreground hover:text-foreground underline"
                      >
                        Cancel
                      </button>
                    </div>
                    <MaintenanceForm
                      equipmentId={selectedResult.equipmentId}
                      equipmentName={selectedResult.name}
                      // Pre-select PREDICTIVE_INTERVENTION since this is opened
                      // from a model risk flag — closes the ML feedback loop
                      defaultEventSource="PREDICTIVE_INTERVENTION"
                      onSuccess={() => {
                        setShowSchedulePM(false);
                        setSelectedResult(null);
                        // Invalidate predictions so dashboard reflects the new maintenance
                        queryClient.invalidateQueries({
                          queryKey: ["/api/risk-score/multi-horizon/latest"],
                        });
                        queryClient.invalidateQueries({
                          queryKey: ["/api/equipment/:id/projection", selectedResult.equipmentId],
                        });
                      }}
                    />
                  </div>
                )}
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