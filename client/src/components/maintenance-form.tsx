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
import { Loader2, AlertCircle, Info } from "lucide-react";
import { DialogFooter } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

// ── Event source options ───────────────────────────────────────────────────────
// Answers WHY this event was triggered — separate from maintenanceType (WHAT was done).
// Used by the ML feedback loop to distinguish interventions from breakdowns.
const EVENT_SOURCE_OPTIONS = [
  {
    value: "SCHEDULED_PM",
    label: "Scheduled PM",
    description: "Vendor interval or calendar-based service",
    color: "text-blue-700 bg-blue-50 border-blue-200",
  },
  {
    value: "PREDICTIVE_INTERVENTION",
    label: "Predictive Intervention",
    description: "Triggered by model HIGH/MEDIUM risk flag",
    color: "text-purple-700 bg-purple-50 border-purple-200",
  },
  {
    value: "REACTIVE_REPAIR",
    label: "Reactive Repair",
    description: "Breakdown response — unit failed in field",
    color: "text-red-700 bg-red-50 border-red-200",
  },
  {
    value: "PRE_DISPATCH_INSPECTION",
    label: "Pre-Dispatch Inspection",
    description: "Triggered by rental dispatch risk guard",
    color: "text-orange-700 bg-orange-50 border-orange-200",
  },
] as const;

type EventSourceValue = typeof EVENT_SOURCE_OPTIONS[number]["value"];

const maintenanceFormSchema = z.object({
  equipmentId: z.number(),
  maintenanceDate: z.string(),
  maintenanceType: z.enum(["INSPECTION", "MINOR_SERVICE", "MAJOR_SERVICE"]),
  eventSource: z.enum([
    "SCHEDULED_PM",
    "PREDICTIVE_INTERVENTION",
    "REACTIVE_REPAIR",
    "PRE_DISPATCH_INSPECTION",
  ]).default("SCHEDULED_PM"),
  description: z.string().optional(),
  performedBy: z.string().optional(),
  cost: z.string().optional(),
  nextDueDate: z.string().optional(),
});

type MaintenanceFormProps = {
  equipmentId: number;
  equipmentName?: string;
  // Pre-select event source when form is opened from a specific context
  // e.g. opened from the risk dashboard → PREDICTIVE_INTERVENTION
  defaultEventSource?: EventSourceValue;
  onSuccess: () => void;
};

const getTodayDate = (): string => {
  return new Date().toISOString().split('T')[0];
};

export function MaintenanceForm({
  equipmentId,
  equipmentName,
  defaultEventSource = "SCHEDULED_PM",
  onSuccess,
}: MaintenanceFormProps) {
  const createMutation = useCreateMaintenance();

  const form = useForm({
    resolver: zodResolver(maintenanceFormSchema),
    defaultValues: {
      equipmentId,
      maintenanceDate: getTodayDate(),
      maintenanceType: "INSPECTION" as const,
      eventSource: defaultEventSource,
      description: "",
      performedBy: "",
      cost: "",
      nextDueDate: "",
    },
  });

  const watchedEventSource = form.watch("eventSource") as EventSourceValue;
  const selectedSourceOption = EVENT_SOURCE_OPTIONS.find(o => o.value === watchedEventSource);

  const onSubmit = (data: any) => {
    const payload = {
      ...data,
      cost: data.cost || null,
      nextDueDate: data.nextDueDate || null,
    };

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
                  <Input type="date" {...field} max={getTodayDate()} />
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

        {/* ── Event Source ─────────────────────────────────────────────────── */}
        <FormField
          control={form.control as any}
          name="eventSource"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="flex items-center gap-1.5">
                Trigger Reason
                <span className="text-xs font-normal text-muted-foreground">(why was this performed?)</span>
              </FormLabel>
              <FormControl>
                <Select onValueChange={field.onChange} value={field.value}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select reason" />
                  </SelectTrigger>
                  <SelectContent>
                    {EVENT_SOURCE_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        <div className="flex flex-col">
                          <span>{option.label}</span>
                          <span className="text-xs text-muted-foreground">{option.description}</span>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormControl>

              {/* Contextual callout based on selected source */}
              {selectedSourceOption && (
                <div className={cn(
                  "flex items-start gap-2 text-xs px-3 py-2 rounded-lg border mt-1",
                  selectedSourceOption.color
                )}>
                  <Info className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
                  <span>
                    {watchedEventSource === "SCHEDULED_PM" && (
                      "Calendar or hours-based service. Keeps the PM program compliant and warranty intact."
                    )}
                    {watchedEventSource === "PREDICTIVE_INTERVENTION" && (
                      "Logging this as a predictive intervention closes the feedback loop — the model learns which flags lead to real actions."
                    )}
                    {watchedEventSource === "REACTIVE_REPAIR" && (
                      "Unit failed in the field. Note: a reactive repair often indicates systemic wear — consider scheduling a follow-up inspection within 30 days."
                    )}
                    {watchedEventSource === "PRE_DISPATCH_INSPECTION" && (
                      "Dispatch-triggered inspection. If issues were found, upgrade type to Minor or Major Service."
                    )}
                  </span>
                </div>
              )}

              <FormMessage />
            </FormItem>
          )}
        />

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
                  <Input placeholder="Technician name" {...field} />
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
                  <Input type="number" step="0.01" placeholder="0.00" {...field} />
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
                <Input type="date" {...field} min={getTodayDate()} />
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