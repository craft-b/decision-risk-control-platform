// client/src/components/equipment-detail-view.tsx

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Package, DollarSign, MapPin, Calendar, Wrench } from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";

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
      {/* Header with Status */}
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

      {/* Basic Information */}
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

      {/* Pricing */}
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
              <div className="text-2xl font-bold text-green-600">
                ${equipment.dailyRate}
              </div>
            </div>
            {equipment.weeklyRate && (
              <div className="text-center p-4 border rounded-lg">
                <div className="text-sm text-muted-foreground mb-1">Weekly</div>
                <div className="text-2xl font-bold text-green-600">
                  ${equipment.weeklyRate}
                </div>
              </div>
            )}
            {equipment.monthlyRate && (
              <div className="text-center p-4 border rounded-lg">
                <div className="text-sm text-muted-foreground mb-1">Monthly</div>
                <div className="text-2xl font-bold text-green-600">
                  ${equipment.monthlyRate}
                </div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Location */}
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

      {/* Metadata */}
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
    </div>
  );
}