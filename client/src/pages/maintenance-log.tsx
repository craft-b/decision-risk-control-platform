import { useState, useEffect } from "react";
import { useMaintenance } from "@/hooks/use-maintenance";
import { useEquipment } from "@/hooks/use-equipment";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { MaintenanceForm } from "@/components/maintenance-form";
import { Plus, Wrench, Calendar, DollarSign, User, ChevronDown } from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 100;

export default function MaintenanceLog() {
  const { user } = useAuth();
  const [selectedEquipmentId, setSelectedEquipmentId] = useState<number | undefined>();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [equipmentForMaintenance, setEquipmentForMaintenance] = useState<any>(null);
  const [offset, setOffset] = useState(0);
  const [displayedEvents, setDisplayedEvents] = useState<any[]>([]);

  const { data, isLoading, isFetching } = useMaintenance({
    equipmentId: selectedEquipmentId,
    limit: PAGE_SIZE,
    offset,
  });
  const { data: equipment } = useEquipment();

  // Append incoming page to the displayed list; reset on first page
  useEffect(() => {
    if (!data?.events) return;
    setDisplayedEvents(prev => offset === 0 ? data.events : [...prev, ...data.events]);
  }, [data]);

  const handleEquipmentFilter = (val: string) => {
    setSelectedEquipmentId(val === "all" ? undefined : parseInt(val));
    setOffset(0);
  };

  const isAdmin = user?.role === 'ADMINISTRATOR';

  const handleAddMaintenance = (equip?: any) => {
    setEquipmentForMaintenance(equip || null);
    setIsDialogOpen(true);
  };

  const getMaintenanceTypeColor = (type: string) => {
    switch (type) {
      case 'MAJOR_SERVICE':
        return 'bg-green-50 text-green-700 border-green-200';
      case 'MINOR_SERVICE':
        return 'bg-blue-50 text-blue-700 border-blue-200';
      case 'INSPECTION':
        return 'bg-yellow-50 text-yellow-700 border-yellow-200';
      default:
        return 'bg-gray-50 text-gray-700 border-gray-200';
    }
  };

  const formatMaintenanceType = (type: string) => {
    return type.replace('_', ' ').toLowerCase()
      .split(' ')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  };

  // Stats — total from server, cost/recent from loaded events
  const totalEvents = data?.total ?? 0;
  const totalCost = displayedEvents.reduce((sum: number, event: any) => {
    return sum + parseFloat(event.cost || '0');
  }, 0);
  const lastMonth = new Date();
  lastMonth.setMonth(lastMonth.getMonth() - 1);
  const recentEvents = displayedEvents.filter((event: any) =>
    new Date(event.maintenanceDate) >= lastMonth
  ).length;

  const hasMore = data ? (offset + PAGE_SIZE) < data.total : false;

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Maintenance Log</h2>
          <p className="text-muted-foreground">
            {totalEvents > 0
              ? `${totalEvents.toLocaleString()} total events`
              : 'Track maintenance events and service history'}
          </p>
        </div>

        {isAdmin && (
          <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
            <DialogTrigger asChild>
              <Button onClick={() => handleAddMaintenance()}>
                <Plus className="mr-2 h-4 w-4" />
                Log Maintenance
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl">
              <DialogHeader>
                <DialogTitle>Log Maintenance Event</DialogTitle>
                <DialogDescription>
                  Record maintenance performed on equipment
                </DialogDescription>
              </DialogHeader>
              {equipmentForMaintenance ? (
                <MaintenanceForm
                  equipmentId={equipmentForMaintenance.id}
                  equipmentName={equipmentForMaintenance.name}
                  onSuccess={() => setIsDialogOpen(false)}
                />
              ) : (
                <div className="space-y-4">
                  <div className="text-sm text-muted-foreground">
                    Select equipment to log maintenance:
                  </div>
                  <Select onValueChange={(val) => {
                    const equip = equipment?.find(e => e.id === parseInt(val));
                    if (equip) setEquipmentForMaintenance(equip);
                  }}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select equipment" />
                    </SelectTrigger>
                    <SelectContent>
                      {equipment?.map((eq) => (
                        <SelectItem key={eq.id} value={eq.id.toString()}>
                          {eq.name} ({eq.equipmentId})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {equipmentForMaintenance && (
                    <MaintenanceForm
                      equipmentId={equipmentForMaintenance.id}
                      equipmentName={equipmentForMaintenance.name}
                      onSuccess={() => {
                        setIsDialogOpen(false);
                        setEquipmentForMaintenance(null);
                      }}
                    />
                  )}
                </div>
              )}
            </DialogContent>
          </Dialog>
        )}
      </div>

      {/* Stats Cards */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Events</CardTitle>
            <Wrench className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalEvents.toLocaleString()}</div>
            <p className="text-xs text-muted-foreground">
              All maintenance records
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Recent Events</CardTitle>
            <Calendar className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{recentEvents}</div>
            <p className="text-xs text-muted-foreground">
              Last 30 days
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Cost</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">${totalCost.toFixed(2)}</div>
            <p className="text-xs text-muted-foreground">
              Maintenance expenses
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Filter */}
      <Card>
        <CardHeader>
          <CardTitle>Filter Events</CardTitle>
          <CardDescription>Filter by equipment</CardDescription>
        </CardHeader>
        <CardContent>
          <Select
            value={selectedEquipmentId?.toString() || "all"}
            onValueChange={handleEquipmentFilter}
          >
            <SelectTrigger className="w-[300px]">
              <SelectValue placeholder="All Equipment" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Equipment</SelectItem>
              {equipment?.map((eq) => (
                <SelectItem key={eq.id} value={eq.id.toString()}>
                  {eq.name} ({eq.equipmentId})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      {/* Maintenance Events Table */}
      <Card>
        <CardHeader>
          <CardTitle>Maintenance History</CardTitle>
          <CardDescription>
            Complete log of all maintenance events
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Equipment</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Description</TableHead>
                <TableHead>Performed By</TableHead>
                <TableHead className="text-right">Cost</TableHead>
                <TableHead>Next Due</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center py-12 text-muted-foreground">
                    Loading maintenance events...
                  </TableCell>
                </TableRow>
              ) : displayedEvents.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center py-12 text-muted-foreground">
                    No maintenance events found
                  </TableCell>
                </TableRow>
              ) : (
                displayedEvents.map((event: any) => {
                  const equip = equipment?.find(e => e.id === event.equipmentId);
                  return (
                    <TableRow key={event.id}>
                      <TableCell>
                        <div className="font-medium">
                          {format(new Date(event.maintenanceDate), 'MMM d, yyyy')}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="font-medium">{equip?.name || 'Unknown'}</div>
                        <div className="text-xs text-muted-foreground">{equip?.equipmentId}</div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={cn("text-xs", getMaintenanceTypeColor(event.maintenanceType))}>
                          {formatMaintenanceType(event.maintenanceType)}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <span className="text-xs text-muted-foreground">
                          {event.eventSource
                            ? event.eventSource.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c: string) => c.toUpperCase())
                            : '-'}
                        </span>
                      </TableCell>
                      <TableCell>
                        <div className="max-w-xs truncate text-sm text-muted-foreground">
                          {event.description || '-'}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1 text-sm">
                          {event.performedBy ? (
                            <>
                              <User className="h-3 w-3 text-muted-foreground" />
                              {event.performedBy}
                            </>
                          ) : (
                            <span className="text-muted-foreground">-</span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        {event.cost ? (
                          <span className="font-medium">${parseFloat(event.cost).toFixed(2)}</span>
                        ) : (
                          <span className="text-muted-foreground">-</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {event.nextDueDate ? (
                          <div className="text-sm">
                            {format(new Date(event.nextDueDate), 'MMM d, yyyy')}
                          </div>
                        ) : (
                          <span className="text-muted-foreground text-sm">-</span>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
          {/* Load more / footer */}
          {(hasMore || isFetching) && (
            <div className="flex items-center justify-between pt-4 border-t">
              <p className="text-sm text-muted-foreground">
                Showing {displayedEvents.length.toLocaleString()} of {totalEvents.toLocaleString()} events
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setOffset(prev => prev + PAGE_SIZE)}
                disabled={isFetching}
              >
                {isFetching ? (
                  <span className="flex items-center gap-2">
                    <span className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
                    Loading...
                  </span>
                ) : (
                  <span className="flex items-center gap-2">
                    <ChevronDown className="h-4 w-4" />
                    Load more
                  </span>
                )}
              </Button>
            </div>
          )}
          {!hasMore && !isFetching && displayedEvents.length > 0 && displayedEvents.length < totalEvents && (
            <p className="pt-4 text-center text-sm text-muted-foreground border-t">
              All {totalEvents.toLocaleString()} events loaded
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}