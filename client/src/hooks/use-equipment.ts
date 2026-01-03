import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, buildUrl } from "@shared/routes";
import { InsertEquipment } from "@shared/schema";
import { useToast } from "@/hooks/use-toast";

export function useEquipment(params?: { search?: string; status?: "AVAILABLE" | "RENTED" | "MAINTENANCE" }) {
  // Construct query key based on params to enable caching per filter state
  const queryKey = [api.equipment.list.path, params?.search, params?.status];

  return useQuery({
    queryKey,
    queryFn: async () => {
      const url = new URL(api.equipment.list.path, window.location.origin);
      if (params?.search) url.searchParams.set("search", params.search);
      if (params?.status) url.searchParams.set("status", params.status);

      const res = await fetch(url.toString(), { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch equipment");
      
      return api.equipment.list.responses[200].parse(await res.json());
    },
  });
}

export function useEquipmentItem(id: number) {
  return useQuery({
    queryKey: [api.equipment.get.path, id],
    queryFn: async () => {
      const url = buildUrl(api.equipment.get.path, { id });
      const res = await fetch(url, { credentials: "include" });
      
      if (res.status === 404) return null;
      if (!res.ok) throw new Error("Failed to fetch equipment details");
      
      return api.equipment.get.responses[200].parse(await res.json());
    },
    enabled: !!id,
  });
}

export function useCreateEquipment() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (data: InsertEquipment) => {
      const validated = api.equipment.create.input.parse(data);
      const res = await fetch(api.equipment.create.path, {
        method: api.equipment.create.method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(validated),
        credentials: "include",
      });

      if (!res.ok) {
        if (res.status === 400) {
          const error = api.equipment.create.responses[400].parse(await res.json());
          throw new Error(error.message);
        }
        throw new Error("Failed to create equipment");
      }
      return api.equipment.create.responses[201].parse(await res.json());
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [api.equipment.list.path] });
      toast({ title: "Equipment created successfully" });
    },
    onError: (err) => {
      toast({ title: "Error creating equipment", description: err.message, variant: "destructive" });
    },
  });
}

export function useUpdateEquipment() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ id, ...updates }: { id: number } & Partial<InsertEquipment>) => {
      const validated = api.equipment.update.input.parse(updates);
      const url = buildUrl(api.equipment.update.path, { id });
      
      const res = await fetch(url, {
        method: api.equipment.update.method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(validated),
        credentials: "include",
      });

      if (!res.ok) {
        if (res.status === 400) {
          const error = api.equipment.update.responses[400].parse(await res.json());
          throw new Error(error.message);
        }
        throw new Error("Failed to update equipment");
      }
      return api.equipment.update.responses[200].parse(await res.json());
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: [api.equipment.list.path] });
      queryClient.invalidateQueries({ queryKey: [api.equipment.get.path, data.id] });
      toast({ title: "Equipment updated successfully" });
    },
    onError: (err) => {
      toast({ title: "Error updating equipment", description: err.message, variant: "destructive" });
    },
  });
}
