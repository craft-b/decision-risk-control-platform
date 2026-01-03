import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { insertRentalSchema, InsertRental } from "@shared/schema";
import { useCreateRental } from "@/hooks/use-rentals";
import { useEquipment } from "@/hooks/use-equipment";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2 } from "lucide-react";
import { DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "./ui/textarea";

type RentalFormProps = {
  onSuccess: () => void;
};

export function RentalForm({ onSuccess }: RentalFormProps) {
  const createMutation = useCreateRental();
  const { data: equipmentList } = useEquipment({ status: "AVAILABLE" });

  const form = useForm<InsertRental>({
    resolver: zodResolver(insertRentalSchema),
    defaultValues: {
      equipmentId: 0,
      customerName: "",
      jobSite: "",
      startDate: new Date().toISOString().split('T')[0], // Today
      endDate: "",
      status: "ACTIVE",
      notes: ""
    },
  });

  const onSubmit = (data: InsertRental) => {
    // Force equipmentId to number as Select returns string
    const payload = { ...data, equipmentId: Number(data.equipmentId) };
    createMutation.mutate(payload, { onSuccess });
  };

  const isPending = createMutation.isPending;

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <FormField
          control={form.control}
          name="equipmentId"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Equipment</FormLabel>
              <FormControl>
                <Select onValueChange={(val) => field.onChange(Number(val))} defaultValue={field.value?.toString()}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select available equipment" />
                  </SelectTrigger>
                  <SelectContent>
                    {equipmentList?.map((eq) => (
                      <SelectItem key={eq.id} value={eq.id.toString()}>
                        {eq.name} ({eq.category}) - ${eq.dailyRate}/day
                      </SelectItem>
                    ))}
                    {(!equipmentList || equipmentList.length === 0) && (
                      <SelectItem value="0" disabled>No available equipment</SelectItem>
                    )}
                  </SelectContent>
                </Select>
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="customerName"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Customer Name</FormLabel>
              <FormControl>
                <Input placeholder="Client Name" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="jobSite"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Job Site</FormLabel>
              <FormControl>
                <Input placeholder="123 Construction Blvd" {...field} value={field.value || ''} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="grid grid-cols-2 gap-4">
          <FormField
            control={form.control}
            name="startDate"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Start Date</FormLabel>
                <FormControl>
                  <Input type="date" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
           <FormField
            control={form.control}
            name="endDate"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Est. End Date</FormLabel>
                <FormControl>
                  <Input type="date" {...field} value={field.value || ''} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <FormField
          control={form.control}
          name="notes"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Notes</FormLabel>
              <FormControl>
                <Textarea placeholder="Any special instructions..." {...field} value={field.value || ''} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <DialogFooter>
          <Button type="submit" disabled={isPending} className="w-full">
            {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Create Rental Agreement
          </Button>
        </DialogFooter>
      </form>
    </Form>
  );
}
