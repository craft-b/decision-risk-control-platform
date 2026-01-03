import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, buildUrl } from "@shared/routes";
import { InsertRental } from "@shared/schema";
import { useToast } from "@/hooks/use-toast";
import { z } from "zod";

export function useRentals() {
  return useQuery({
    queryKey: [api.rentals.list.path],
    queryFn: async () => {
      const res = await fetch(api.rentals.list.path, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch rentals");
      return api.rentals.list.responses[200].parse(await res.json());
    },
  });
}

export function useCreateRental() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (data: InsertRental) => {
      // Coerce date strings to Date objects for validation if necessary, but schema expects strings for dates mostly in JSON
      const res = await fetch(api.rentals.create.path, {
        method: api.rentals.create.method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
        credentials: "include",
      });

      if (!res.ok) {
        if (res.status === 400) {
          const error = api.rentals.create.responses[400].parse(await res.json());
          throw new Error(error.message);
        }
        throw new Error("Failed to create rental");
      }
      return api.rentals.create.responses[201].parse(await res.json());
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [api.rentals.list.path] });
      queryClient.invalidateQueries({ queryKey: [api.equipment.list.path] }); // Equipment status changes
      toast({ title: "Rental created successfully" });
    },
    onError: (err) => {
      toast({ title: "Error creating rental", description: err.message, variant: "destructive" });
    },
  });
}

export function useCompleteRental() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ id, endDate, notes }: { id: number; endDate: string; notes?: string }) => {
      const url = buildUrl(api.rentals.complete.path, { id });
      const res = await fetch(url, {
        method: api.rentals.complete.method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endDate, notes }),
        credentials: "include",
      });

      if (!res.ok) {
        throw new Error("Failed to complete rental");
      }
      return api.rentals.complete.responses[200].parse(await res.json());
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [api.rentals.list.path] });
      queryClient.invalidateQueries({ queryKey: [api.equipment.list.path] }); // Equipment freed up
      toast({ title: "Rental completed successfully" });
    },
    onError: (err) => {
      toast({ title: "Error completing rental", description: err.message, variant: "destructive" });
    },
  });
}
