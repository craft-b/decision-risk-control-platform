import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useCreateVendor, useUpdateVendor } from "@/hooks/use-vendors";
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
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2, AlertCircle } from "lucide-react";
import { DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "./ui/textarea";

// Form schema WITHOUT vendorId (auto-generated on backend)
const vendorFormSchema = z.object({
  name: z.string().min(1, "Name is required"),
  address: z.string().optional().nullable(),
  salesPerson: z.string().optional().nullable(),
  contact: z.string().optional().nullable(),
});

type VendorFormData = z.infer<typeof vendorFormSchema>;

type VendorFormProps = {
  onSuccess: () => void;
  initialData?: any;
};

export function VendorForm({ onSuccess, initialData }: VendorFormProps) {
  const isEditing = !!initialData?.id;
  const createMutation = useCreateVendor();
  const updateMutation = useUpdateVendor();

  const form = useForm<VendorFormData>({
    resolver: zodResolver(vendorFormSchema),
    defaultValues: initialData ? {
      name: initialData.name || "",
      address: initialData.address || "",
      salesPerson: initialData.salesPerson || "",
      contact: initialData.contact || "",
    } : {
      name: "",
      address: "",
      salesPerson: "",
      contact: "",
    },
  });

  const onSubmit = (data: VendorFormData) => {
    if (isEditing && initialData?.id) {
      updateMutation.mutate(
        { id: initialData.id, ...data },
        { onSuccess }
      );
    } else {
      // Backend will generate vendorId automatically
      createMutation.mutate(data as any, {
        onSuccess: () => {
          form.reset();
          onSuccess();
        }
      });
    }
  };

  const isPending = createMutation.isPending || updateMutation.isPending;

  return (
    <Form {...form as any}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4" noValidate>
        {(createMutation.isError || updateMutation.isError) && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              {createMutation.error?.message || updateMutation.error?.message || 'Failed to save vendor.'}
            </AlertDescription>
          </Alert>
        )}

        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Vendor Name</FormLabel>
              <FormControl>
                <Input 
                  placeholder="ABC Equipment Rentals" 
                  {...field}
                  value={field.value ?? ""}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="address"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Address (Optional)</FormLabel>
              <FormControl>
                <Textarea 
                  placeholder="456 Industrial Blvd, City, State 12345" 
                  {...field}
                  value={field.value ?? ""}
                  rows={2}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <FormField
            control={form.control}
            name="salesPerson"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Sales Person (Optional)</FormLabel>
                <FormControl>
                  <Input 
                    placeholder="Jane Smith" 
                    {...field}
                    value={field.value ?? ""}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="contact"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Contact Info (Optional)</FormLabel>
                <FormControl>
                  <Input 
                    placeholder="sales@vendor.com or (555) 987-6543" 
                    {...field}
                    value={field.value ?? ""}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <DialogFooter>
          <Button 
            type="submit" 
            disabled={isPending} 
            className="w-full"
          >
            {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {isEditing ? "Update Vendor" : "Create Vendor"}
          </Button>
        </DialogFooter>
      </form>
    </Form>
  );
}