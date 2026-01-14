import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, buildUrl } from "@shared/routes";
import { useToast } from "@/hooks/use-toast";

export function useMaintenance(equipmentId?: number) {
  return useQuery({
    queryKey: ['maintenance', equipmentId],
    queryFn: async () => {
      const url = equipmentId 
        ? `${api.maintenance.list.path}?equipmentId=${equipmentId}`
        : api.maintenance.list.path;
      
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch maintenance events");
      return api.maintenance.list.responses[200].parse(await res.json());
    },
  });
}

export function useMaintenanceHistory(equipmentId: number) {
  return useQuery({
    queryKey: ['maintenance', 'history', equipmentId],
    queryFn: async () => {
      const url = buildUrl(api.maintenance.getByEquipment.path, { id: equipmentId });
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch maintenance history");
      return api.maintenance.getByEquipment.responses[200].parse(await res.json());
    },
    enabled: !!equipmentId,
  });
}

export function useCreateMaintenance() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (data: any) => {
      const res = await fetch(api.maintenance.create.path, {
        method: api.maintenance.create.method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
        credentials: "include",
      });

      if (!res.ok) {
        const error = await res.json().catch(() => ({ message: 'Failed to create maintenance event' }));
        throw new Error(error.message);
      }
      return api.maintenance.create.responses[201].parse(await res.json());
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['maintenance'] });
      queryClient.invalidateQueries({ queryKey: ['risk-scores'] });
      queryClient.invalidateQueries({ queryKey: [api.equipment.list.path] });
      toast({ title: "Maintenance event logged successfully" });
    },
    onError: (err) => {
      toast({ title: "Error logging maintenance", description: err.message, variant: "destructive" });
    },
  });
}