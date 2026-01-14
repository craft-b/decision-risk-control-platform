import { useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { 
  useFleetRisk, 
  useEquipmentWithRisk, 
  useRunPredictions,
  useGenerateSnapshots,
  useLabelSnapshots,
  usePipelineStatus
} from "@/hooks/use-predictive-maintenance";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { 
  AlertTriangle, 
  CheckCircle, 
  TrendingUp, 
  Activity,
  Loader2,
  Play,
  Database,
  Tag
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

// Pipeline Status Card Component
function PipelineStatusCard() {
  const { data: status } = usePipelineStatus();
  
  if (!status) return null;
  
  return (
    <Card className="border-blue-200">
      <CardHeader>
        <CardTitle>Pipeline Status</CardTitle>
        <CardDescription>Current ML pipeline data readiness</CardDescription>
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
            <div className="text-sm text-muted-foreground">Predictions</div>
            <div className="text-2xl font-bold">{status.predictions.total}</div>
            <div className="text-xs text-muted-foreground">
              Using {status.modelStatus} model
            </div>
          </div>
        </div>
        
        {status.readyForTraining ? (
          <Alert className="border-green-200 bg-green-50">
            <CheckCircle className="h-4 w-4 text-green-600" />
            <AlertDescription className="text-green-800">
              <strong>Ready for ML training!</strong> You have {status.snapshots.labeled} labeled samples.
            </AlertDescription>
          </Alert>
        ) : (
          <Alert>
            <AlertDescription>
              Need {100 - status.snapshots.labeled} more labeled samples for ML training.
              Generate snapshots and wait 30 days for labeling.
            </AlertDescription>
          </Alert>
        )}
        
        {status.snapshots.oldestDate && (
          <div className="text-xs text-muted-foreground">
            Data range: {new Date(status.snapshots.oldestDate).toLocaleDateString()} to{' '}
            {new Date(status.snapshots.newestDate).toLocaleDateString()}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

type RiskBand = 'HIGH' | 'MEDIUM' | 'LOW';

export default function PredictiveMaintenanceDashboard() {
  const { user } = useAuth();
  const { data: fleetRisk, isLoading: isLoadingFleet } = useFleetRisk();
  const { data: equipment, isLoading: isLoadingEquipment } = useEquipmentWithRisk();
  const runPredictions = useRunPredictions();
  const generateSnapshots = useGenerateSnapshots();
  const labelSnapshots = useLabelSnapshots();
  
  const [selectedEquipment, setSelectedEquipment] = useState<any>(null);

  const isAdmin = user?.role === 'ADMINISTRATOR';

  // Calculate risk percentages
  const riskPercentages = fleetRisk ? {
    low: fleetRisk.total > 0 ? Math.round((fleetRisk.low / fleetRisk.total) * 100) : 0,
    medium: fleetRisk.total > 0 ? Math.round((fleetRisk.medium / fleetRisk.total) * 100) : 0,
    high: fleetRisk.total > 0 ? Math.round((fleetRisk.high / fleetRisk.total) * 100) : 0,
  } : null;

  // Sort equipment by risk (HIGH first)
  const sortedEquipment = equipment ? [...equipment].sort((a, b) => {
    const riskOrder: Record<RiskBand, number> = { HIGH: 3, MEDIUM: 2, LOW: 1 };
    const aRisk = (a.risk?.riskBand || 'LOW') as RiskBand;
    const bRisk = (b.risk?.riskBand || 'LOW') as RiskBand;
    return riskOrder[bRisk] - riskOrder[aRisk];
  }) : [];

  const highRiskEquipment = sortedEquipment.filter(e => e.risk?.riskBand === 'HIGH');

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      {/* Header */}
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Predictive Maintenance</h2>
          <p className="text-muted-foreground">ML-powered equipment failure risk analysis</p>
        </div>
        
        {isAdmin && (
          <div className="flex gap-2">
            <Button 
              onClick={() => runPredictions.mutate(undefined)}
              disabled={runPredictions.isPending}
              className="gap-2"
            >
              {runPredictions.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Play className="h-4 w-4" />
              )}
              Run Predictions
            </Button>
          </div>
        )}
      </div>

      {/* Alert for high-risk equipment */}
      {highRiskEquipment.length > 0 && (
        <Alert className="border-red-200 bg-red-50">
          <AlertTriangle className="h-4 w-4 text-red-600" />
          <AlertDescription className="text-red-800">
            <strong>{highRiskEquipment.length} equipment item{highRiskEquipment.length !== 1 ? 's' : ''}</strong> flagged as HIGH RISK - immediate maintenance recommended
          </AlertDescription>
        </Alert>
      )}

      {/* Pipeline Status Card */}
      <PipelineStatusCard />

      {/* Fleet Risk Distribution Cards */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Equipment</CardTitle>
            <Activity className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{fleetRisk?.total || 0}</div>
            <p className="text-xs text-muted-foreground">
              Active fleet items
            </p>
          </CardContent>
        </Card>

        <Card className="border-red-200 bg-red-50">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-red-900">High Risk</CardTitle>
            <AlertTriangle className="h-4 w-4 text-red-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-900">{fleetRisk?.high || 0}</div>
            <p className="text-xs text-red-700">
              {riskPercentages?.high || 0}% of fleet
            </p>
          </CardContent>
        </Card>

        <Card className="border-orange-200 bg-orange-50">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-orange-900">Medium Risk</CardTitle>
            <TrendingUp className="h-4 w-4 text-orange-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-orange-900">{fleetRisk?.medium || 0}</div>
            <p className="text-xs text-orange-700">
              {riskPercentages?.medium || 0}% of fleet
            </p>
          </CardContent>
        </Card>

        <Card className="border-green-200 bg-green-50">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-green-900">Low Risk</CardTitle>
            <CheckCircle className="h-4 w-4 text-green-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-900">{fleetRisk?.low || 0}</div>
            <p className="text-xs text-green-700">
              {riskPercentages?.low || 0}% of fleet
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Equipment List with Risk */}
      <Card>
        <CardHeader>
          <CardTitle>Equipment Risk Status</CardTitle>
          <CardDescription>
            Click any equipment to see detailed risk analysis and recommendations
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoadingEquipment ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : sortedEquipment.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              No equipment found. Run predictions to generate risk scores.
            </div>
          ) : (
            <div className="space-y-2">
              {sortedEquipment.map((equip) => (
                <div
                  key={equip.id}
                  onClick={() => setSelectedEquipment(equip)}
                  className={cn(
                    "flex items-center justify-between p-4 rounded-lg border cursor-pointer transition-all",
                    "hover:bg-slate-50 hover:border-slate-300",
                    equip.risk?.riskBand === 'HIGH' && "border-red-200 bg-red-50",
                    equip.risk?.riskBand === 'MEDIUM' && "border-orange-200 bg-orange-50",
                    equip.risk?.riskBand === 'LOW' && "border-green-200 bg-green-50",
                    !equip.risk && "border-slate-200"
                  )}
                >
                  <div className="flex-1">
                    <div className="font-medium">{equip.name}</div>
                    <div className="text-sm text-muted-foreground">
                      {equip.category} • {equip.equipmentId}
                    </div>
                  </div>

                  <div className="flex items-center gap-4">
                    {equip.risk ? (
                      <>
                        <div className="text-right">
                          <div className="text-sm font-medium">
                            {(equip.risk.failureProbability * 100).toFixed(0)}% Risk
                          </div>
                          <div className="text-xs text-muted-foreground">
                            failure probability
                          </div>
                        </div>
                        <Badge
                          variant="outline"
                          className={cn(
                            equip.risk.riskBand === 'HIGH' && "bg-red-100 text-red-800 border-red-300",
                            equip.risk.riskBand === 'MEDIUM' && "bg-orange-100 text-orange-800 border-orange-300",
                            equip.risk.riskBand === 'LOW' && "bg-green-100 text-green-800 border-green-300"
                          )}
                        >
                          {equip.risk.riskBand}
                        </Badge>
                      </>
                    ) : (
                      <Badge variant="outline" className="bg-slate-100 text-slate-600">
                        No Prediction
                      </Badge>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Admin Controls */}
      {isAdmin && (
        <Card>
          <CardHeader>
            <CardTitle>ML Pipeline Controls</CardTitle>
            <CardDescription>
              Administrative controls for the predictive maintenance pipeline
            </CardDescription>
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
              <Button
                variant="outline"
                onClick={() => generateSnapshots.mutate(undefined)}
                disabled={generateSnapshots.isPending}
              >
                {generateSnapshots.isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Database className="mr-2 h-4 w-4" />
                )}
                Generate
              </Button>
            </div>

            <div className="flex items-start gap-4 p-4 border rounded-lg">
              <Tag className="h-5 w-5 text-purple-600 mt-0.5" />
              <div className="flex-1">
                <div className="font-medium">Label Historical Data</div>
                <div className="text-sm text-muted-foreground">
                  Label snapshots with failure outcomes for model training
                </div>
              </div>
              <Button
                variant="outline"
                onClick={() => labelSnapshots.mutate(undefined)}
                disabled={labelSnapshots.isPending}
              >
                {labelSnapshots.isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Tag className="mr-2 h-4 w-4" />
                )}
                Label
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Equipment Detail Modal */}
      {selectedEquipment && (
        <Dialog open={!!selectedEquipment} onOpenChange={() => setSelectedEquipment(null)}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>{selectedEquipment.name}</DialogTitle>
              <DialogDescription>
                {selectedEquipment.category} • {selectedEquipment.equipmentId}
              </DialogDescription>
            </DialogHeader>

            {selectedEquipment.risk ? (
              <div className="space-y-6">
                {/* Risk Score */}
                <div className="flex items-center justify-between p-6 rounded-lg border-2 border-dashed">
                  <div>
                    <div className="text-sm text-muted-foreground mb-1">Failure Risk Score</div>
                    <div className="text-4xl font-bold">
                      {(selectedEquipment.risk.failureProbability * 100).toFixed(1)}%
                    </div>
                  </div>
                  <Badge
                    className={cn(
                      "text-lg px-4 py-2",
                      selectedEquipment.risk.riskBand === 'HIGH' && "bg-red-100 text-red-800 border-red-300",
                      selectedEquipment.risk.riskBand === 'MEDIUM' && "bg-orange-100 text-orange-800 border-orange-300",
                      selectedEquipment.risk.riskBand === 'LOW' && "bg-green-100 text-green-800 border-green-300"
                    )}
                  >
                    {selectedEquipment.risk.riskBand} RISK
                  </Badge>
                </div>

                {/* Recommendation */}
                <Alert>
                  <AlertTriangle className="h-4 w-4" />
                  <AlertDescription>
                    <strong>Recommendation:</strong> {selectedEquipment.risk.recommendation}
                  </AlertDescription>
                </Alert>

                {/* Top Risk Drivers */}
                <div>
                  <h3 className="font-semibold mb-3">Top Risk Drivers</h3>
                  <div className="space-y-3">
                    {selectedEquipment.risk.topDrivers.map((driver: any, idx: number) => (
                      <div key={idx} className="space-y-1">
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-medium">{driver.description}</span>
                          <span className="text-sm text-muted-foreground">
                            +{(driver.impact * 100).toFixed(1)}%
                          </span>
                        </div>
                        <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-red-500"
                            style={{ width: `${driver.impact * 100}%` }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Model Info */}
                <div className="pt-4 border-t text-xs text-muted-foreground">
                  Predicted on {new Date(selectedEquipment.risk.predictedAt).toLocaleDateString()}
                </div>
              </div>
            ) : (
              <div className="text-center py-12 text-muted-foreground">
                No risk prediction available for this equipment.
              </div>
            )}
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}