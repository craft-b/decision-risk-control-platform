import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { insertRentalSchema, InsertRental } from "@shared/schema";
import { useCreateRental, useUpdateRental } from "@/hooks/use-rentals";
import { useEquipment } from "@/hooks/use-equipment";
import { useJobSites } from "@/hooks/use-jobsites";
import { useVendors } from "@/hooks/use-vendors";
import { useLatestMultiHorizonPredictions } from "@/hooks/use-risk-score";
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
import { Loader2, AlertCircle, AlertTriangle } from "lucide-react";
import { DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "./ui/textarea";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

type RentalFormProps = {
  onSuccess: () => void;
  initialData?: any;
};

const getTodayDate = (): string => {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, '0');
  const day = String(today.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

export function RentalForm({ onSuccess, initialData }: RentalFormProps) {
  const isEditing = !!initialData?.id;
  const createMutation = useCreateRental();
  const updateMutation = useUpdateRental();

  // ── Risk guard state ───────────────────────────────────────────────────────
  const [dispatchConfirmed, setDispatchConfirmed] = useState(false);

  // Fetch data for dropdowns
  const { data: equipmentList, isLoading: isLoadingEquipment } = useEquipment({ status: "AVAILABLE" });
  const { data: jobSites, isLoading: isLoadingJobSites } = useJobSites();
  const { data: vendors, isLoading: isLoadingVendors } = useVendors();

  // Latest multi-horizon predictions for risk guard
  const { data: latestPredictions } = useLatestMultiHorizonPredictions();

  const form = useForm<any>({
    resolver: zodResolver(insertRentalSchema),
    defaultValues: initialData || {
      equipmentId: 0,
      jobSiteId: 0,
      vendorId: null,
      poNumber: "",
      receiveDate: getTodayDate(),
      receiveHours: null,
      receiveDocument: "",
      returnDate: "",
      returnHours: null,
      returnDocument: "",
      buyRent: "RENT",
      status: "ACTIVE",
      notes: ""
    },
  });

  const receiveDate  = form.watch("receiveDate");
  const returnDate   = form.watch("returnDate");
  const watchedEquipmentId = form.watch("equipmentId");

  // ── Derive risk level for selected equipment ───────────────────────────────
  const equipmentRisk = latestPredictions?.find(
    (p: any) => (p.equipmentId ?? p.equipment_id) === watchedEquipmentId
  );

  const riskLevel30d: string | undefined =
    equipmentRisk?.predictions?.["30d"]?.risk_level ??
    equipmentRisk?.risk_level_30d;

  const failureProb30d: number = Number(
    equipmentRisk?.predictions?.["30d"]?.failure_probability ??
    equipmentRisk?.prob_30d ??
    0
  );

  // Estimate rental duration for contextual messaging
  const rentalDays = (() => {
    if (!returnDate || !receiveDate) return null;
    const diff =
      (new Date(returnDate).getTime() - new Date(receiveDate).getTime()) /
      86_400_000;
    return diff > 0 ? Math.round(diff) : null;
  })();

  // Reset acknowledgement whenever dispatcher picks a different piece of equipment
  useEffect(() => {
    setDispatchConfirmed(false);
  }, [watchedEquipmentId]);

  useEffect(() => {
    if (receiveDate && returnDate && returnDate < receiveDate) {
      form.setError("returnDate", {
        type: "manual",
        message: "Return date must be after receive date"
      });
    } else {
      form.clearErrors("returnDate");
    }
  }, [receiveDate, returnDate, form]);

  const onSubmit = (data: InsertRental) => {
    const formatDate = (dateStr: any) => {
      if (!dateStr) return null;
      if (typeof dateStr === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
        return dateStr;
      }
      const date = new Date(dateStr);
      if (isNaN(date.getTime())) return null;
      return date.toISOString().split('T')[0];
    };

    const payload = {
      ...data,
      receiveDate: formatDate(data.receiveDate) || getTodayDate(),
      returnDate: formatDate(data.returnDate),
    };

    if (isEditing && initialData?.id) {
      updateMutation.mutate(
        { id: initialData.id, data: payload },
        { onSuccess }
      );
    } else {
      createMutation.mutate(payload as any, {
        onSuccess: () => {
          form.reset();
          onSuccess();
        }
      });
    }
  };

  const isPending = createMutation.isPending || updateMutation.isPending;
  const hasAvailableEquipment = equipmentList && equipmentList.length > 0;
  const hasJobSites = jobSites && jobSites.length > 0;

  // Submit is blocked when equipment is HIGH risk and dispatcher hasn't acknowledged
  const isBlockedByRisk = riskLevel30d === "HIGH" && !dispatchConfirmed;

  return (
    <Form {...form as any}>
      <form onSubmit={form.handleSubmit(onSubmit as any)} className="space-y-4" noValidate>

        {/* ── Mutation errors ──────────────────────────────────────────────── */}
        {(createMutation.isError || updateMutation.isError) && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              {createMutation.error?.message || updateMutation.error?.message || 'Failed to save rental.'}
            </AlertDescription>
          </Alert>
        )}

        {!isLoadingEquipment && !hasAvailableEquipment && (
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              No equipment is currently available for rent.
            </AlertDescription>
          </Alert>
        )}

        {!isLoadingJobSites && !hasJobSites && (
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              No job sites available. Please create a job site first.
            </AlertDescription>
          </Alert>
        )}

        {/* ── Equipment selector ───────────────────────────────────────────── */}
        <FormField
          control={form.control as any}
          name="equipmentId"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Equipment</FormLabel>
              <FormControl>
                <Select
                  onValueChange={(val) => field.onChange(Number(val))}
                  value={field.value?.toString()}
                  disabled={isLoadingEquipment || !hasAvailableEquipment}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={
                      isLoadingEquipment ? "Loading..." : "Select equipment"
                    } />
                  </SelectTrigger>
                  <SelectContent>
                    {equipmentList?.map((eq) => (
                      <SelectItem key={eq.id} value={eq.id.toString()}>
                        {eq.name} ({eq.category}) - ${eq.dailyRate}/day
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* ── Track G: Risk Guard ──────────────────────────────────────────── */}
        {watchedEquipmentId > 0 && equipmentRisk && (
          <div className="space-y-2">

            {/* HIGH risk — blocking warning */}
            {riskLevel30d === "HIGH" && (
              <Alert className="border-red-300 bg-red-50">
                <AlertTriangle className="h-4 w-4 text-red-600 mt-0.5 flex-shrink-0" />
                <AlertDescription className="text-red-800">
                  <div className="font-semibold mb-1">
                    ⚠ High Failure Risk — {Math.round(failureProb30d * 100)}% probability within 30 days
                  </div>
                  <div className="text-xs space-y-1">
                    <div>This equipment is flagged HIGH risk by the predictive maintenance model.</div>
                    {rentalDays && rentalDays > 10 && (
                      <div>
                        Planned rental of <strong>{rentalDays} days</strong> extends
                        into the high-risk window.
                      </div>
                    )}
                    <div className="pt-1">
                      Recommend scheduling maintenance before dispatch or selecting alternate equipment.
                    </div>
                  </div>

                  {!dispatchConfirmed ? (
                    <button
                      type="button"
                      onClick={() => setDispatchConfirmed(true)}
                      className="mt-2 text-xs underline text-red-700 hover:text-red-900 transition-colors"
                    >
                      I understand the risk — proceed anyway
                    </button>
                  ) : (
                    <div className="mt-2 text-xs font-medium text-red-700 flex items-center gap-1">
                      <AlertCircle className="h-3 w-3" />
                      Risk acknowledged — dispatch confirmed
                    </div>
                  )}
                </AlertDescription>
              </Alert>
            )}

            {/* MEDIUM risk — advisory only, no block */}
            {riskLevel30d === "MEDIUM" && (
              <Alert className="border-orange-200 bg-orange-50">
                <AlertTriangle className="h-4 w-4 text-orange-500 flex-shrink-0" />
                <AlertDescription className="text-orange-800 text-sm">
                  <span className="font-medium">Medium failure risk</span> —{" "}
                  {Math.round(failureProb30d * 100)}% probability within 30 days.{" "}
                  {rentalDays && rentalDays > 20
                    ? "Consider scheduling a service check mid-rental."
                    : "Monitor closely during the rental period."}
                </AlertDescription>
              </Alert>
            )}

          </div>
        )}

        {/* ── Job site ─────────────────────────────────────────────────────── */}
        <FormField
          control={form.control as any}
          name="jobSiteId"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Job Site</FormLabel>
              <FormControl>
                <Select
                  onValueChange={(val) => field.onChange(Number(val))}
                  value={field.value?.toString()}
                  disabled={isLoadingJobSites || !hasJobSites}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={
                      isLoadingJobSites ? "Loading..." : "Select job site"
                    } />
                  </SelectTrigger>
                  <SelectContent>
                    {jobSites?.map((site) => (
                      <SelectItem key={site.id} value={site.id.toString()}>
                        {site.name} ({site.jobId})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormControl>
              <FormDescription>
                Where will this equipment be used?
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* ── Vendor ───────────────────────────────────────────────────────── */}
        <FormField
          control={form.control as any}
          name="vendorId"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Vendor (Optional)</FormLabel>
              <FormControl>
                <Select
                  onValueChange={(val) => field.onChange(val === "none" ? null : Number(val))}
                  value={field.value?.toString() || "none"}
                  disabled={isLoadingVendors}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={
                      isLoadingVendors ? "Loading..." : "Select vendor (optional)"
                    } />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No vendor</SelectItem>
                    {vendors?.map((vendor) => (
                      <SelectItem key={vendor.id} value={vendor.id.toString()}>
                        {vendor.name} ({vendor.vendorId})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* ── PO + Type ────────────────────────────────────────────────────── */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <FormField
            control={form.control as any}
            name="poNumber"
            render={({ field }) => (
              <FormItem>
                <FormLabel>PO Number (Optional)</FormLabel>
                <FormControl>
                  <Input
                    placeholder="PO-12345"
                    {...field}
                    value={field.value ?? ""}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control as any}
            name="buyRent"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Type</FormLabel>
                <FormControl>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select type" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="RENT">Rent</SelectItem>
                      <SelectItem value="BUY">Buy</SelectItem>
                    </SelectContent>
                  </Select>
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        {/* ── Dates ────────────────────────────────────────────────────────── */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <FormField
            control={form.control as any}
            name="receiveDate"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Receive Date</FormLabel>
                <FormControl>
                  <Input
                    type="date"
                    value={field.value || getTodayDate()}
                    onChange={(e) => field.onChange(e.target.value)}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control as any}
            name="receiveHours"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Receive Hours (Optional)</FormLabel>
                <FormControl>
                  <Input
                    type="number"
                    step="0.1"
                    placeholder="0.0"
                    {...field}
                    value={field.value ?? ""}
                    onChange={(e) => {
                      const val = e.target.value;
                      field.onChange(val === "" ? null : val);
                    }}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <FormField
            control={form.control as any}
            name="returnDate"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Return Date (Optional)</FormLabel>
                <FormControl>
                  <Input
                    type="date"
                    value={field.value || ""}
                    onChange={(e) => field.onChange(e.target.value || null)}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control as any}
            name="returnHours"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Return Hours (Optional)</FormLabel>
                <FormControl>
                  <Input
                    type="number"
                    step="0.1"
                    placeholder="0.0"
                    {...field}
                    value={field.value ?? ""}
                    onChange={(e) => {
                      const val = e.target.value;
                      field.onChange(val === "" ? null : val);
                    }}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        {/* ── Status ───────────────────────────────────────────────────────── */}
        <FormField
          control={form.control as any}
          name="status"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Status</FormLabel>
              <FormControl>
                <Select onValueChange={field.onChange} value={field.value}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ACTIVE">Active</SelectItem>
                    <SelectItem value="COMPLETED">Completed</SelectItem>
                    <SelectItem value="CANCELLED">Cancelled</SelectItem>
                  </SelectContent>
                </Select>
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* ── Notes ────────────────────────────────────────────────────────── */}
        <FormField
          control={form.control as any}
          name="notes"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Notes (Optional)</FormLabel>
              <FormControl>
                <Textarea
                  placeholder="Any special instructions..."
                  {...field}
                  value={field.value ?? ""}
                  rows={3}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* ── Submit ───────────────────────────────────────────────────────── */}
        <DialogFooter>
          <Button
            type="submit"
            disabled={
              isPending ||
              (!isEditing && (!hasAvailableEquipment || !hasJobSites)) ||
              isBlockedByRisk
            }
            className={cn(
              "w-full",
              isBlockedByRisk && "opacity-50 cursor-not-allowed",
              riskLevel30d === "HIGH" && dispatchConfirmed && "bg-red-600 hover:bg-red-700"
            )}
          >
            {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {isBlockedByRisk
              ? "Acknowledge Risk to Dispatch"
              : riskLevel30d === "HIGH" && dispatchConfirmed
              ? isEditing ? "Update Rental" : "Dispatch Anyway"
              : isEditing ? "Update Rental" : "Create Rental"}
          </Button>
        </DialogFooter>

      </form>
    </Form>
  );
}