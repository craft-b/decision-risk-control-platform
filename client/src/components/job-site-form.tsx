import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useCreateJobSite, useUpdateJobSite } from "@/hooks/use-jobsites";
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

// Form schema WITHOUT jobId (auto-generated on backend)
const jobSiteFormSchema = z.object({
  name: z.string().min(1, "Name is required"),
  address: z.string().optional().nullable(),
  contactPerson: z.string().optional().nullable(),
  contactPhone: z.string().optional().nullable(),
});

type JobSiteFormData = z.infer<typeof jobSiteFormSchema>;

type JobSiteFormProps = {
  onSuccess: () => void;
  initialData?: any;
};

export function JobSiteForm({ onSuccess, initialData }: JobSiteFormProps) {
  const isEditing = !!initialData?.id;
  const createMutation = useCreateJobSite();
  const updateMutation = useUpdateJobSite();

  const form = useForm<JobSiteFormData>({
    resolver: zodResolver(jobSiteFormSchema),
    defaultValues: initialData ? {
      name: initialData.name || "",
      address: initialData.address || "",
      contactPerson: initialData.contactPerson || "",
      contactPhone: initialData.contactPhone || "",
    } : {
      name: "",
      address: "",
      contactPerson: "",
      contactPhone: "",
    },
  });

  const onSubmit = (data: JobSiteFormData) => {
    if (isEditing && initialData?.id) {
      updateMutation.mutate(
        { id: initialData.id, ...data },
        { onSuccess }
      );
    } else {
      // Backend will generate jobId automatically
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
              {createMutation.error?.message || updateMutation.error?.message || 'Failed to save job site.'}
            </AlertDescription>
          </Alert>
        )}

        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Job Site Name</FormLabel>
              <FormControl>
                <Input 
                  placeholder="Downtown Construction Project" 
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
                  placeholder="123 Main St, City, State 12345" 
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
            name="contactPerson"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Contact Person (Optional)</FormLabel>
                <FormControl>
                  <Input 
                    placeholder="John Doe" 
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
            name="contactPhone"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Contact Phone (Optional)</FormLabel>
                <FormControl>
                  <Input 
                    type="tel"
                    placeholder="(555) 123-4567" 
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
            {isEditing ? "Update Job Site" : "Create Job Site"}
          </Button>
        </DialogFooter>
      </form>
    </Form>
  );
}