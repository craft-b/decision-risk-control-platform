// client/src/pages/EquipmentList.tsx - Complete with Detail View

import { useState } from "react";
import { useEquipment, useCreateEquipment, useUpdateEquipment } from "@/hooks/use-equipment";
import { useEquipmentRisk } from "@/hooks/use-predictive-maintenance";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Plus, Search, AlertTriangle } from "lucide-react";
import { EquipmentForm } from "@/components/equipment-form";
import { EquipmentDetailView } from "@/components/equipment-detail-view";
import { cn } from "@/lib/utils";

// Risk Badge Component
function RiskBadge({ equipmentId }: { equipmentId: number }) {
  const { data: risk, isLoading } = useEquipmentRisk(equipmentId);

  if (isLoading) {
    return <Badge variant="outline" className="bg-slate-100">...</Badge>;
  }

  if (!risk) {
    return <Badge variant="outline" className="bg-slate-100">No Data</Badge>;
  }

  return (
    <div className="flex items-center gap-2">
      <Badge
        variant="outline"
        className={cn(
          "font-medium",
          risk.riskBand === 'HIGH' && "bg-red-100 text-red-800 border-red-300",
          risk.riskBand === 'MEDIUM' && "bg-orange-100 text-orange-800 border-orange-300",
          risk.riskBand === 'LOW' && "bg-green-100 text-green-800 border-green-300"
        )}
      >
        {risk.riskBand === 'HIGH' && <AlertTriangle className="h-3 w-3 mr-1" />}
        {risk.riskBand}
      </Badge>
      <span className="text-xs text-muted-foreground">
        {(risk.failureProbability * 100).toFixed(0)}%
      </span>
    </div>
  );
}

export default function EquipmentList() {
  const { user } = useAuth();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"AVAILABLE" | "RENTED" | "MAINTENANCE" | "">("");
  const [isNewEquipmentOpen, setIsNewEquipmentOpen] = useState(false);
  const [editingEquipment, setEditingEquipment] = useState<any>(null);
  const [viewingEquipment, setViewingEquipment] = useState<any>(null);

  const { data: equipment, isLoading } = useEquipment({ 
    search, 
    status: statusFilter || undefined 
  });

  const isAdmin = user?.role === 'ADMINISTRATOR';

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Equipment Fleet</h2>
          <p className="text-muted-foreground">Manage your equipment inventory with ML-powered risk insights</p>
        </div>
        
        {isAdmin && (
          <Dialog open={isNewEquipmentOpen} onOpenChange={setIsNewEquipmentOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="mr-2 h-4 w-4" /> New Equipment
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>Add Equipment</DialogTitle>
                <DialogDescription>
                  Add new equipment to your fleet
                </DialogDescription>
              </DialogHeader>
              <EquipmentForm onSuccess={() => setIsNewEquipmentOpen(false)} />
            </DialogContent>
          </Dialog>
        )}
      </div>

      {/* Filters */}
      <div className="flex gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search equipment..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-10"
          />
        </div>
        <Select 
          value={statusFilter || "all"} 
          onValueChange={(val) => setStatusFilter(val === "all" ? "" : val as "AVAILABLE" | "RENTED" | "MAINTENANCE")}
        >
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="All Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="AVAILABLE">Available</SelectItem>
            <SelectItem value="RENTED">Rented</SelectItem>
            <SelectItem value="MAINTENANCE">Maintenance</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Equipment Table */}
      <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
        <Table>
          <TableHeader className="bg-slate-50">
            <TableRow>
              <TableHead>Equipment</TableHead>
              <TableHead>Category</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Risk Level</TableHead>
              <TableHead>Daily Rate</TableHead>
              {isAdmin && <TableHead className="text-right">Actions</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={isAdmin ? 6 : 5} className="text-center py-12 text-muted-foreground">
                  Loading equipment...
                </TableCell>
              </TableRow>
            ) : equipment?.length === 0 ? (
              <TableRow>
                <TableCell colSpan={isAdmin ? 6 : 5} className="text-center py-12 text-muted-foreground">
                  No equipment found.
                </TableCell>
              </TableRow>
            ) : (
              equipment?.map((equip) => (
                <TableRow 
                  key={equip.id}
                  className="cursor-pointer hover:bg-slate-50"
                  onClick={() => setViewingEquipment(equip)}
                >
                  <TableCell>
                    <div className="font-medium">{equip.name}</div>
                    <div className="text-sm text-muted-foreground font-mono">
                      {equip.equipmentId}
                    </div>
                  </TableCell>
                  <TableCell>{equip.category}</TableCell>
                  <TableCell>
                    <Badge
                      variant="outline"
                      className={cn(
                        equip.status === 'AVAILABLE' && "bg-green-50 text-green-700 border-green-200",
                        equip.status === 'RENTED' && "bg-blue-50 text-blue-700 border-blue-200",
                        equip.status === 'MAINTENANCE' && "bg-orange-50 text-orange-700 border-orange-200"
                      )}
                    >
                      {equip.status}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <RiskBadge equipmentId={equip.id} />
                  </TableCell>
                  <TableCell className="font-semibold">${equip.dailyRate}/day</TableCell>
                  {isAdmin && (
                    <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setEditingEquipment(equip)}
                      >
                        Edit
                      </Button>
                    </TableCell>
                  )}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Edit Dialog */}
      {editingEquipment && (
        <Dialog open={!!editingEquipment} onOpenChange={() => setEditingEquipment(null)}>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Edit Equipment</DialogTitle>
              <DialogDescription>
                Update equipment details
              </DialogDescription>
            </DialogHeader>
            <EquipmentForm
              initialData={editingEquipment}
              onSuccess={() => setEditingEquipment(null)}
            />
          </DialogContent>
        </Dialog>
      )}

      {/* Detail View Dialog */}
      {viewingEquipment && (
        <Dialog open={!!viewingEquipment} onOpenChange={() => setViewingEquipment(null)}>
          <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Equipment Details</DialogTitle>
              <DialogDescription>
                View complete equipment information
              </DialogDescription>
            </DialogHeader>
            <EquipmentDetailView equipment={viewingEquipment} />
            {isAdmin && (
              <div className="flex justify-end pt-4 border-t">
                <Button
                  onClick={() => {
                    setEditingEquipment(viewingEquipment);
                    setViewingEquipment(null);
                  }}
                >
                  Edit Equipment
                </Button>
              </div>
            )}
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}