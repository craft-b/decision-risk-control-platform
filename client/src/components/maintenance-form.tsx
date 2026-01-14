import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useCreateMaintenance } from "@/hooks/use-maintenance";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  FormDescription,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2, AlertCircle } from "lucide-react";
import { DialogFooter } from "@/components/ui/dialog";

const maintenanceFormSchema = z.object({
  equipmentId: z.number(),
  maintenanceDate: z.string(),
  maintenanceType: z.enum(["INSPECTION", "MINOR_SERVICE", "MAJOR_SERVICE"]),
  description: z.string().optional(),
  performedBy: z.string().optional(),
  cost: z.string().optional(),
  nextDueDate: z.string().optional(),
});

type MaintenanceFormProps = {
  equipmentId: number;
  equipmentName?: string;
  onSuccess: () => void;
};

const getTodayDate = (): string => {
  const today = new Date();
  return today.toISOString().split('T')[0];
};

export function MaintenanceForm({ equipmentId, equipmentName, onSuccess }: MaintenanceFormProps) {
  const createMutation = useCreateMaintenance();

  const form = useForm({
    resolver: zodResolver(maintenanceFormSchema),
    defaultValues: {
      equipmentId,
      maintenanceDate: getTodayDate(),
      maintenanceType: "INSPECTION" as const,
      description: "",
      performedBy: "",
      cost: "",
      nextDueDate: "",
    },
  });

  const onSubmit = (data: any) => {
  // Format the data properly
  const payload = {
    ...data,
    // Ensure cost is sent as string or null
    cost: data.cost || null,
    // Ensure dates are properly formatted
    nextDueDate: data.nextDueDate || null,
  };
  
  console.log('Submitting maintenance data:', payload); // Debug log
  
  createMutation.mutate(payload, {
    onSuccess: () => {
      form.reset();
      onSuccess();
    },
  });
};

  return (
    <Form {...form as any}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        {createMutation.isError && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              {createMutation.error?.message || 'Failed to log maintenance event'}
            </AlertDescription>
          </Alert>
        )}

        {equipmentName && (
          <div className="text-sm text-muted-foreground mb-4">
            Logging maintenance for: <span className="font-semibold">{equipmentName}</span>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <FormField
            control={form.control as any}
            name="maintenanceDate"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Maintenance Date</FormLabel>
                <FormControl>
                  <Input 
                    type="date" 
                    {...field}
                    max={getTodayDate()}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control as any}
            name="maintenanceType"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Maintenance Type</FormLabel>
                <FormControl>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select type" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="INSPECTION">Inspection</SelectItem>
                      <SelectItem value="MINOR_SERVICE">Minor Service</SelectItem>
                      <SelectItem value="MAJOR_SERVICE">Major Service</SelectItem>
                    </SelectContent>
                  </Select>
                </FormControl>
                <FormDescription>
                  Major service provides the most risk reduction
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <FormField
          control={form.control as any}
          name="description"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Description (Optional)</FormLabel>
              <FormControl>
                <Textarea 
                  placeholder="Details about the maintenance performed..."
                  {...field}
                  rows={3}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <FormField
            control={form.control as any}
            name="performedBy"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Performed By (Optional)</FormLabel>
                <FormControl>
                  <Input 
                    placeholder="Technician name"
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control as any}
            name="cost"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Cost (Optional)</FormLabel>
                <FormControl>
                  <Input 
                    type="number"
                    step="0.01"
                    placeholder="0.00"
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <FormField
          control={form.control as any}
          name="nextDueDate"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Next Service Due (Optional)</FormLabel>
              <FormControl>
                <Input 
                  type="date" 
                  {...field}
                  min={getTodayDate()}
                />
              </FormControl>
              <FormDescription>
                Recommended next maintenance date
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <DialogFooter>
          <Button 
            type="submit" 
            disabled={createMutation.isPending}
            className="w-full"
          >
            {createMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Log Maintenance Event
          </Button>
        </DialogFooter>
      </form>
    </Form>
  );
}