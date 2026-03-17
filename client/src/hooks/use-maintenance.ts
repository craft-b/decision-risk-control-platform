import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, buildUrl } from "@shared/routes";
import { useToast } from "@/hooks/use-toast";

export function useMaintenance(params: {
  equipmentId?: number;
  limit?: number;
  offset?: number;
} = {}) {
  const { equipmentId, limit = 100, offset = 0 } = params;
  return useQuery({
    queryKey: ['maintenance', equipmentId, limit, offset],
    queryFn: async () => {
      const qs = new URLSearchParams();
      if (equipmentId != null) qs.set('equipmentId', String(equipmentId));
      qs.set('limit',  String(limit));
      qs.set('offset', String(offset));
      const res = await fetch(`${api.maintenance.list.path}?${qs}`, { credentials: "include" });
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

export function useMaintenanceDueSoon() {
  return useQuery({
    queryKey: ['/api/maintenance/due-soon'],
    queryFn: async () => {
      const res = await fetch('/api/maintenance/due-soon', { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch due-soon maintenance');
      return res.json() as Promise<Array<{
        id: number;
        name: string;
        equipmentId: string;
        category: string;
        status: string;
        nextDueDate: string;
        daysUntilDue: number;
      }>>;
    },
    staleTime: 5 * 60 * 1000,
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
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['maintenance'] });
      queryClient.invalidateQueries({ queryKey: ['risk-scores'] });
      queryClient.invalidateQueries({ queryKey: [api.equipment.list.path] });
      // Invalidate multi-horizon predictions so dashboard reflects new maintenance
      queryClient.invalidateQueries({
        queryKey: ["/api/risk-score/multi-horizon/latest"]
      });
      // Invalidate projection cache for this specific unit
      queryClient.invalidateQueries({
        queryKey: ["/api/equipment/:id/projection", variables.equipmentId]
      });
      // Delayed re-invalidation — the ML rescore runs async on the server via setImmediate
      // after the 201 is sent. Give it 3s to complete, then pull fresh predictions.
      setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ["/api/risk-score/multi-horizon/latest"] });
      }, 3000);
      toast({
        title: "Maintenance logged",
        description: "Risk scores will update shortly."
      });
    }
  });
}