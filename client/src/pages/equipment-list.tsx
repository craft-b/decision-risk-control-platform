import { useState } from "react";
import { useEquipment } from "@/hooks/use-equipment";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Plus, Search, Filter, Hammer, Truck } from "lucide-react";
import { EquipmentForm } from "@/components/equipment-form";
import { InsertEquipment } from "@shared/schema";
import { cn } from "@/lib/utils";

export default function EquipmentList() {
  const { user } = useAuth();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"AVAILABLE" | "RENTED" | "MAINTENANCE" | undefined>(undefined);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<(InsertEquipment & { id: number }) | undefined>(undefined);

  const { data: equipment, isLoading } = useEquipment({ 
    search: search || undefined, 
    status: statusFilter 
  });

  const isAdmin = user?.role === 'ADMINISTRATOR';

  const handleEdit = (item: any) => {
    setEditingItem(item);
    setIsDialogOpen(true);
  };

  const closeDialog = () => {
    setIsDialogOpen(false);
    setEditingItem(undefined);
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Equipment Fleet</h2>
          <p className="text-muted-foreground">Manage your heavy machinery inventory.</p>
        </div>
        
        {isAdmin && (
          <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
            <DialogTrigger asChild>
              <Button onClick={() => setEditingItem(undefined)}>
                <Plus className="mr-2 h-4 w-4" /> Add Equipment
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl">
              <DialogHeader>
                <DialogTitle>{editingItem ? "Edit Equipment" : "Add New Equipment"}</DialogTitle>
                <DialogDescription>
                  {editingItem ? "Update details for this asset." : "Enter details for the new machine."}
                </DialogDescription>
              </DialogHeader>
              <EquipmentForm 
                onSuccess={closeDialog} 
                initialData={editingItem}
              />
            </DialogContent>
          </Dialog>
        )}
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search equipment by name or serial number..."
            className="pl-8"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Select 
          value={statusFilter || "ALL"} 
          onValueChange={(val) => setStatusFilter(val === "ALL" ? undefined : val as any)}
        >
          <SelectTrigger className="w-[180px]">
             <div className="flex items-center gap-2">
                <Filter className="h-4 w-4" />
                <SelectValue placeholder="Filter by Status" />
             </div>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All Statuses</SelectItem>
            <SelectItem value="AVAILABLE">Available</SelectItem>
            <SelectItem value="RENTED">Rented</SelectItem>
            <SelectItem value="MAINTENANCE">Maintenance</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Grid */}
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {[1,2,3].map(i => <div key={i} className="h-64 rounded-xl bg-slate-100 animate-pulse" />)}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {equipment?.map((item) => (
            <Card key={item.id} className="group hover:shadow-lg transition-all duration-300 border-l-4" style={{ 
              borderLeftColor: item.status === 'AVAILABLE' ? '#22c55e' : item.status === 'RENTED' ? '#f97316' : '#ef4444' 
            }}>
              <CardHeader>
                <div className="flex justify-between items-start">
                  <div>
                    <CardTitle className="text-lg font-bold flex items-center gap-2">
                       {item.name}
                    </CardTitle>
                    <CardDescription className="font-mono text-xs mt-1">
                      {item.serialNumber || 'No S/N'}
                    </CardDescription>
                  </div>
                  <Badge variant="outline" className={cn(
                    "uppercase text-[10px] tracking-wider font-bold",
                    item.status === 'AVAILABLE' ? "bg-green-50 text-green-700 border-green-200" : 
                    item.status === 'RENTED' ? "bg-orange-50 text-orange-700 border-orange-200" : 
                    "bg-red-50 text-red-700 border-red-200"
                  )}>
                    {item.status}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Category:</span>
                  <span className="font-medium">{item.category}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Daily Rate:</span>
                  <span className="font-medium">${item.dailyRate}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Location:</span>
                  <span className="font-medium">{item.location}</span>
                </div>
                {item.condition && (
                   <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Condition:</span>
                    <span className="font-medium text-xs bg-slate-100 px-2 py-0.5 rounded text-slate-700">
                      {item.condition}
                    </span>
                  </div>
                )}
              </CardContent>
              {isAdmin && (
                <CardFooter className="bg-slate-50/50 p-4 border-t">
                  <Button 
                    variant="ghost" 
                    size="sm" 
                    className="w-full text-slate-500 hover:text-primary"
                    onClick={() => handleEdit(item)}
                  >
                    Edit Details
                  </Button>
                </CardFooter>
              )}
            </Card>
          ))}
          
          {equipment?.length === 0 && (
            <div className="col-span-full py-20 text-center bg-slate-50 rounded-xl border border-dashed">
              <Truck className="h-12 w-12 mx-auto text-slate-300 mb-4" />
              <p className="text-lg font-medium text-slate-600">No equipment found</p>
              <p className="text-slate-400">Try adjusting your filters or search terms.</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
