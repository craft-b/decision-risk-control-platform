import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { insertEquipmentSchema, InsertEquipment } from "@shared/schema";
import { useCreateEquipment, useUpdateEquipment } from "@/hooks/use-equipment";
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
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2, AlertCircle } from "lucide-react";
import { DialogFooter } from "@/components/ui/dialog";

const EQUIPMENT_CATEGORIES = [
  "Excavator", "Lift", "Dozer", "Loader", "Generator",
] as const;

const EQUIPMENT_STATUSES = [
  { value: "AVAILABLE", label: "Available" },
  { value: "RENTED", label: "Rented" },
  { value: "MAINTENANCE", label: "Maintenance" },
] as const;

type EquipmentFormProps = {
  initialData?: InsertEquipment & { id?: number };
  onSuccess: () => void;
};

export function EquipmentForm({ initialData, onSuccess }: EquipmentFormProps) {
  const isEditing = !!initialData?.id;
  const createMutation = useCreateEquipment();
  const updateMutation = useUpdateEquipment();

  const form = useForm<InsertEquipment>({
    resolver: zodResolver(insertEquipmentSchema),
    defaultValues: initialData || {
      equipmentId: "",
      name: "",
      category: "",
      make: "",
      model: "",
      serialNumber: "",
      dailyRate: "0",
      weeklyRate: "",
      monthlyRate: "",
      status: "AVAILABLE",
      location: "",
      yearManufactured: null,
      purchaseDate: "",
      currentMileage: "",
      initialMileage: "",
    },
  });

  const onSubmit = (data: InsertEquipment) => {
    if (isEditing && initialData?.id) {
      updateMutation.mutate(
        { id: initialData.id, ...data },
        { onSuccess: () => onSuccess() }
      );
    } else {
      createMutation.mutate(data, {
        onSuccess: () => {
          form.reset();
          onSuccess();
        },
      });
    }
  };

  const isPending = createMutation.isPending || updateMutation.isPending;
  const error = createMutation.error || updateMutation.error;

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">

        {error && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              {error?.message || `Failed to ${isEditing ? "update" : "create"} equipment.`}
            </AlertDescription>
          </Alert>
        )}

        {/* ── Identity ── */}
        <FormField
          control={form.control}
          name="equipmentId"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Equipment ID</FormLabel>
              <FormControl><Input placeholder="e.g. EQ-001" {...field} /></FormControl>
              <FormDescription>Unique identifier for this equipment</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <FormField
            control={form.control}
            name="name"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Equipment Name</FormLabel>
                <FormControl><Input placeholder="e.g. Hydraulic Excavator" {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="category"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Category</FormLabel>
                <FormControl>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <SelectTrigger><SelectValue placeholder="Select category" /></SelectTrigger>
                    <SelectContent>
                      {EQUIPMENT_CATEGORIES.map((c) => (
                        <SelectItem key={c} value={c}>{c}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <FormField
            control={form.control}
            name="make"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Make (Optional)</FormLabel>
                <FormControl><Input placeholder="e.g. Caterpillar" {...field} value={field.value ?? ""} /></FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="model"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Model (Optional)</FormLabel>
                <FormControl><Input placeholder="e.g. 320" {...field} value={field.value ?? ""} /></FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <FormField
            control={form.control}
            name="serialNumber"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Serial Number (Optional)</FormLabel>
                <FormControl><Input placeholder="SN-123456" {...field} value={field.value ?? ""} /></FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="location"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Location (Optional)</FormLabel>
                <FormControl><Input placeholder="e.g. Site A" {...field} value={field.value ?? ""} /></FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        {/* ── Asset Age & Hours (ML inputs) ── */}
        <div className="border rounded-lg p-4 space-y-4 bg-slate-50">
          <p className="text-sm font-medium text-slate-700">Asset History — used for ML risk scoring</p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FormField
              control={form.control}
              name="yearManufactured"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Year Manufactured (Optional)</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      placeholder="e.g. 2018"
                      {...field}
                      value={field.value ?? ""}
                      onChange={(e) => field.onChange(e.target.value ? parseInt(e.target.value) : null)}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="purchaseDate"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Purchase Date (Optional)</FormLabel>
                  <FormControl>
                    <Input
                      type="date"
                      {...field}
                      value={field.value ? String(field.value).split('T')[0] : ""}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FormField
              control={form.control}
              name="currentMileage"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Current Hours (Optional)</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      step="0.01"
                      min="0"
                      placeholder="e.g. 3500"
                      {...field}
                      value={field.value ?? ""}
                      onChange={(e) => field.onChange(e.target.value)}
                    />
                  </FormControl>
                  <FormDescription>Total operational hours to date</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="initialMileage"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Initial Hours (Optional)</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      step="0.01"
                      min="0"
                      placeholder="e.g. 0"
                      {...field}
                      value={field.value ?? ""}
                      onChange={(e) => field.onChange(e.target.value)}
                    />
                  </FormControl>
                  <FormDescription>Hours at time of acquisition</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
        </div>

        {/* ── Rates ── */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <FormField
            control={form.control}
            name="dailyRate"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Daily Rate ($)</FormLabel>
                <FormControl>
                  <Input type="number" step="0.01" min="0" placeholder="0.00"
                    {...field} onChange={(e) => field.onChange(e.target.value)} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="weeklyRate"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Weekly Rate (Optional)</FormLabel>
                <FormControl>
                  <Input type="number" step="0.01" min="0" placeholder="0.00"
                    {...field} value={field.value ?? ""} onChange={(e) => field.onChange(e.target.value)} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="monthlyRate"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Monthly Rate (Optional)</FormLabel>
                <FormControl>
                  <Input type="number" step="0.01" min="0" placeholder="0.00"
                    {...field} value={field.value ?? ""} onChange={(e) => field.onChange(e.target.value)} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        {/* ── Status ── */}
        <FormField
          control={form.control}
          name="status"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Status</FormLabel>
              <FormControl>
                <Select onValueChange={field.onChange} value={field.value}>
                  <SelectTrigger><SelectValue placeholder="Select status" /></SelectTrigger>
                  <SelectContent>
                    {EQUIPMENT_STATUSES.map((s) => (
                      <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormControl>
              <FormDescription>
                {isEditing && field.value === "RENTED" && (
                  <span className="text-amber-600">⚠️ Changing status may affect active rentals</span>
                )}
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <DialogFooter>
          <Button type="submit" disabled={isPending} className="w-full md:w-auto">
            {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {isEditing ? "Update Equipment" : "Add Equipment"}
          </Button>
        </DialogFooter>

      </form>
    </Form>
  );
}