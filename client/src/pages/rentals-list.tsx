import { useState } from "react";
import { useRentals, useCompleteRental } from "@/hooks/use-rentals";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
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
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Plus, CheckSquare, CalendarDays } from "lucide-react";
import { format } from "date-fns";
import { RentalForm } from "@/components/rental-form";
import { cn } from "@/lib/utils";

export default function RentalsList() {
  const { user } = useAuth();
  const { data: rentals, isLoading } = useRentals();
  const completeMutation = useCompleteRental();
  const [isNewRentalOpen, setIsNewRentalOpen] = useState(false);
  const [completeId, setCompleteId] = useState<number | null>(null);
  
  // State for completion dialog
  const [endDate, setEndDate] = useState(new Date().toISOString().split('T')[0]);
  const [notes, setNotes] = useState("");

  const isAdmin = user?.role === 'ADMINISTRATOR';

  const handleComplete = () => {
    if (completeId) {
      completeMutation.mutate(
        { id: completeId, endDate, notes },
        {
          onSuccess: () => {
            setCompleteId(null);
            setNotes("");
          }
        }
      );
    }
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Active Rentals</h2>
          <p className="text-muted-foreground">Track ongoing rentals and equipment assignments.</p>
        </div>
        
        {isAdmin && (
          <Dialog open={isNewRentalOpen} onOpenChange={setIsNewRentalOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="mr-2 h-4 w-4" /> New Rental
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-xl">
              <DialogHeader>
                <DialogTitle>Create Rental Agreement</DialogTitle>
                <DialogDescription>
                  Assign equipment to a customer and job site.
                </DialogDescription>
              </DialogHeader>
              <RentalForm onSuccess={() => setIsNewRentalOpen(false)} />
            </DialogContent>
          </Dialog>
        )}
      </div>

      <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
        <Table>
          <TableHeader className="bg-slate-50">
            <TableRow>
              <TableHead>Customer / Job Site</TableHead>
              <TableHead>Equipment</TableHead>
              <TableHead>Duration</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
               <TableRow>
                 <TableCell colSpan={5} className="text-center py-12 text-muted-foreground">
                   Loading rentals...
                 </TableCell>
               </TableRow>
            ) : rentals?.length === 0 ? (
               <TableRow>
                 <TableCell colSpan={5} className="text-center py-12 text-muted-foreground">
                   No active rentals found.
                 </TableCell>
               </TableRow>
            ) : (
              rentals?.map((rental) => (
                <TableRow key={rental.id}>
                  <TableCell>
                    <div className="font-medium text-slate-900">{rental.customerName}</div>
                    <div className="text-xs text-muted-foreground">{rental.jobSite || 'No site specified'}</div>
                  </TableCell>
                  <TableCell>
                    <div className="font-medium">{rental.equipment?.name || 'Unknown Equipment'}</div>
                    <div className="text-xs text-muted-foreground font-mono">
                      {rental.equipment?.serialNumber}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col text-sm">
                      <span className="text-green-600 font-medium">{format(new Date(rental.startDate), 'MMM d')}</span>
                      <span className="text-slate-400 text-xs">to</span>
                      <span className="text-slate-600 font-medium">
                        {rental.endDate ? format(new Date(rental.endDate), 'MMM d') : 'Ongoing'}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className={cn(
                      rental.status === 'ACTIVE' ? "bg-orange-50 text-orange-700 border-orange-200" :
                      rental.status === 'COMPLETED' ? "bg-green-50 text-green-700 border-green-200" :
                      "bg-slate-100 text-slate-600"
                    )}>
                      {rental.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    {rental.status === 'ACTIVE' && isAdmin && (
                       <Button 
                        size="sm" 
                        variant="outline" 
                        className="h-8 gap-2 hover:bg-green-50 hover:text-green-700 hover:border-green-200"
                        onClick={() => setCompleteId(rental.id)}
                       >
                         <CheckSquare className="h-4 w-4" />
                         Complete
                       </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Completion Dialog */}
      <Dialog open={!!completeId} onOpenChange={(open) => !open && setCompleteId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Complete Rental</DialogTitle>
            <DialogDescription>
              Mark this rental as returned. This will make the equipment available again.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
             <div className="space-y-2">
               <Label>Return Date</Label>
               <Input 
                 type="date" 
                 value={endDate}
                 onChange={(e) => setEndDate(e.target.value)}
               />
             </div>
             <div className="space-y-2">
               <Label>Notes (Damage, cleaning fees, etc.)</Label>
               <Input 
                 placeholder="Optional notes..."
                 value={notes}
                 onChange={(e) => setNotes(e.target.value)}
               />
             </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCompleteId(null)}>Cancel</Button>
            <Button onClick={handleComplete} disabled={completeMutation.isPending}>
              {completeMutation.isPending && <CalendarDays className="mr-2 h-4 w-4 animate-spin" />}
              Confirm Return
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
