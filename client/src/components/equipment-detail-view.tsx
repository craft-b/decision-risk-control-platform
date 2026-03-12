import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Package, DollarSign, MapPin, Calendar, AlertTriangle,
  CheckCircle, TrendingUp, Loader2, Wrench,
} from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { useEquipmentRisk } from "@/hooks/use-predictive-maintenance";
import { useToast } from "@/hooks/use-toast";

function RiskCard({ equipmentId }: { equipmentId: number }) {
  const { data: risk, isLoading } = useEquipmentRisk(equipmentId);
  const [isScheduling, setIsScheduling] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [scheduledDate, setScheduledDate] = useState(
    format(new Date(), 'yyyy-MM-dd')
  );
  const [maintenanceType, setMaintenanceType] = useState<
    "INSPECTION" | "MINOR_SERVICE" | "MAJOR_SERVICE"
  >("INSPECTION");
  const [description, setDescription] = useState("");
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const suggestedType = risk?.riskBand === 'HIGH'
    ? 'MAJOR_SERVICE'
    : risk?.riskBand === 'MEDIUM'
    ? 'MINOR_SERVICE'
    : 'INSPECTION';

  const handleOpenSchedule = () => {
    setMaintenanceType(suggestedType);
    setDescription(
      risk?.recommendation
        ? risk.recommendation.slice(0, 200)
        : `Scheduled based on ${risk?.riskBand ?? 'current'} risk assessment`
    );
    setIsScheduling(true);
  };

  const handleSubmit = async () => {
    setIsSubmitting(true);
    try {
      // 1. Create maintenance log entry
      const maintRes = await fetch('/api/maintenance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          equipmentId,
          maintenanceDate: scheduledDate,
          maintenanceType,
          description,
          performedBy: 'Scheduled via Risk Assessment',
        }),
      });
      if (!maintRes.ok) throw new Error('Failed to create maintenance entry');

      // 2. Update equipment status to MAINTENANCE
      const equipRes = await fetch(`/api/equipment/${equipmentId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ status: 'MAINTENANCE' }),
      });
      if (!equipRes.ok) throw new Error('Failed to update equipment status');

      await queryClient.invalidateQueries({ queryKey: ['/api/equipment'] });
      await queryClient.invalidateQueries({ queryKey: ['/api/maintenance'] });

      toast({
        title: 'Maintenance Scheduled',
        description: `${maintenanceType.replace('_', ' ')} scheduled for ${format(new Date(scheduledDate), 'MMM d, yyyy')}. Equipment status set to MAINTENANCE.`,
      });
      setIsScheduling(false);
    } catch (err: any) {
      toast({
        title: 'Failed to schedule maintenance',
        description: err.message,
        variant: 'destructive',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5 text-muted-foreground" />
              <CardTitle>Risk Assessment</CardTitle>
            </div>
            {risk && (
              <Button
                size="sm"
                variant={risk.riskBand === 'HIGH' ? 'destructive' : 'outline'}
                onClick={handleOpenSchedule}
              >
                <Wrench className="h-4 w-4 mr-2" />
                Schedule Maintenance
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-6">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : !risk ? (
            <div className="text-sm text-muted-foreground py-4 text-center">
              No risk prediction available. Run predictions from the Predictive Maintenance dashboard.
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center justify-between p-4 rounded-lg border-2 border-dashed">
                <div>
                  <div className="text-xs text-muted-foreground mb-1">Failure Probability</div>
                  <div className="text-3xl font-bold">
                    {(risk.failureProbability * 100).toFixed(1)}%
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">
                    Model {risk.modelVersion} • {format(new Date(risk.snapshotTs), 'MMM d, yyyy')}
                  </div>
                </div>
                <Badge
                  className={cn(
                    "text-base px-4 py-2",
                    risk.riskBand === 'HIGH' && "bg-red-100 text-red-800 border-red-300",
                    risk.riskBand === 'MEDIUM' && "bg-orange-100 text-orange-800 border-orange-300",
                    risk.riskBand === 'LOW' && "bg-green-100 text-green-800 border-green-300"
                  )}
                >
                  {risk.riskBand} RISK
                </Badge>
              </div>

              {risk.recommendation && (
                <Alert className={cn(
                  risk.riskBand === 'HIGH' && "border-red-200 bg-red-50",
                  risk.riskBand === 'MEDIUM' && "border-orange-200 bg-orange-50",
                  risk.riskBand === 'LOW' && "border-green-200 bg-green-50",
                )}>
                  {risk.riskBand === 'HIGH' ? (
                    <AlertTriangle className="h-4 w-4 text-red-600" />
                  ) : risk.riskBand === 'MEDIUM' ? (
                    <AlertTriangle className="h-4 w-4 text-orange-600" />
                  ) : (
                    <CheckCircle className="h-4 w-4 text-green-600" />
                  )}
                  <AlertDescription className="text-sm">
                    {risk.recommendation}
                  </AlertDescription>
                </Alert>
              )}

              {risk.topDrivers && risk.topDrivers.length > 0 && (
                <div>
                  <div className="text-sm font-medium mb-2">Top Risk Drivers</div>
                  <div className="space-y-2">
                    {risk.topDrivers.map((driver: any, idx: number) => (
                      <div key={idx} className="space-y-1">
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-muted-foreground">{driver.description}</span>
                          <span className="font-medium">{(driver.impact * 100).toFixed(1)}%</span>
                        </div>
                        <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                          <div
                            className={cn(
                              "h-full rounded-full",
                              risk.riskBand === 'HIGH' ? "bg-red-500" :
                              risk.riskBand === 'MEDIUM' ? "bg-orange-500" : "bg-green-500"
                            )}
                            style={{ width: `${Math.min(driver.impact * 500, 100)}%` }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Schedule Maintenance Dialog */}
      <Dialog open={isScheduling} onOpenChange={setIsScheduling}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Wrench className="h-5 w-5" />
              Schedule Maintenance
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {risk && (
              <Alert className={cn(
                risk.riskBand === 'HIGH' && "border-red-200 bg-red-50",
                risk.riskBand === 'MEDIUM' && "border-orange-200 bg-orange-50",
                risk.riskBand === 'LOW' && "border-green-200 bg-green-50",
              )}>
                <AlertTriangle className={cn(
                  "h-4 w-4",
                  risk.riskBand === 'HIGH' ? "text-red-600" :
                  risk.riskBand === 'MEDIUM' ? "text-orange-600" : "text-green-600"
                )} />
                <AlertDescription className="text-sm">
                  <strong>{risk.riskBand} RISK</strong> — {(risk.failureProbability * 100).toFixed(1)}% failure probability.
                  Suggested: <strong>{suggestedType.replace(/_/g, ' ')}</strong>
                </AlertDescription>
              </Alert>
            )}

            <div className="space-y-2">
              <label className="text-sm font-medium">Maintenance Type</label>
              <Select
                value={maintenanceType}
                onValueChange={(v) => setMaintenanceType(v as typeof maintenanceType)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="INSPECTION">Inspection</SelectItem>
                  <SelectItem value="MINOR_SERVICE">Minor Service</SelectItem>
                  <SelectItem value="MAJOR_SERVICE">Major Service</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Scheduled Date</label>
              <Input
                type="date"
                value={scheduledDate}
                onChange={(e) => setScheduledDate(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Description</label>
              <Input
                placeholder="Maintenance notes..."
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>

            <p className="text-xs text-muted-foreground">
              Submitting will create a maintenance log entry and set equipment status to <strong>MAINTENANCE</strong>.
            </p>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsScheduling(false)}>
              Cancel
            </Button>
            <Button onClick={handleSubmit} disabled={isSubmitting}>
              {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Confirm Schedule
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

type EquipmentDetailViewProps = {
  equipment: any;
};

export function EquipmentDetailView({ equipment }: EquipmentDetailViewProps) {
  if (!equipment) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        Equipment not found
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-2xl font-bold">{equipment.name}</h3>
          <p className="text-sm text-muted-foreground font-mono">{equipment.equipmentId}</p>
        </div>
        <Badge
          variant="outline"
          className={cn(
            "text-base px-3 py-1",
            equipment.status === 'AVAILABLE' && "bg-green-50 text-green-700 border-green-200",
            equipment.status === 'RENTED' && "bg-blue-50 text-blue-700 border-blue-200",
            equipment.status === 'MAINTENANCE' && "bg-orange-50 text-orange-700 border-orange-200"
          )}
        >
          {equipment.status}
        </Badge>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Package className="h-5 w-5 text-muted-foreground" />
            <CardTitle>Equipment Details</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <div className="text-sm text-muted-foreground">Category</div>
              <div className="font-medium">{equipment.category}</div>
            </div>
            <div>
              <div className="text-sm text-muted-foreground">Make</div>
              <div className="font-medium">{equipment.make || 'N/A'}</div>
            </div>
            <div>
              <div className="text-sm text-muted-foreground">Model</div>
              <div className="font-medium">{equipment.model || 'N/A'}</div>
            </div>
            <div>
              <div className="text-sm text-muted-foreground">Serial Number</div>
              <div className="font-mono font-medium">{equipment.serialNumber || 'N/A'}</div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <DollarSign className="h-5 w-5 text-muted-foreground" />
            <CardTitle>Rental Rates</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 gap-4">
            <div className="text-center p-4 border rounded-lg">
              <div className="text-sm text-muted-foreground mb-1">Daily</div>
              <div className="text-2xl font-bold text-green-600">${equipment.dailyRate}</div>
            </div>
            {equipment.weeklyRate && (
              <div className="text-center p-4 border rounded-lg">
                <div className="text-sm text-muted-foreground mb-1">Weekly</div>
                <div className="text-2xl font-bold text-green-600">${equipment.weeklyRate}</div>
              </div>
            )}
            {equipment.monthlyRate && (
              <div className="text-center p-4 border rounded-lg">
                <div className="text-sm text-muted-foreground mb-1">Monthly</div>
                <div className="text-2xl font-bold text-green-600">${equipment.monthlyRate}</div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {equipment.location && (
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <MapPin className="h-5 w-5 text-muted-foreground" />
              <CardTitle>Current Location</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <p className="text-sm">{equipment.location}</p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Calendar className="h-5 w-5 text-muted-foreground" />
            <CardTitle>System Information</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Added to System</span>
              <span className="font-medium">
                {equipment.createdAt ? format(new Date(equipment.createdAt), 'MMM d, yyyy') : 'N/A'}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Equipment ID</span>
              <span className="font-mono font-medium">{equipment.equipmentId}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Database ID</span>
              <span className="font-mono">{equipment.id}</span>
            </div>
          </div>
        </CardContent>
      </Card>

      <RiskCard equipmentId={equipment.id} />
    </div>
  );
}