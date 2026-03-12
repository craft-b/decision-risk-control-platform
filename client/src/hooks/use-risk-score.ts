import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, buildUrl } from "@shared/routes";
import { useToast } from "@/hooks/use-toast";

// Central hook for retrieving explainable risk scores used across
// dashboards, equipment views, and operational decisions

export function useCalculateRiskScore() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (equipmentId: number) => {
      const res = await fetch(api.riskScore.calculate.path, {
        method: api.riskScore.calculate.method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ equipmentId }),
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to calculate risk score");
      return api.riskScore.calculate.responses[200].parse(await res.json());
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['risk-scores'] });
      toast({ title: "Risk score calculated successfully" });
    },
    onError: (err) => {
      toast({ title: "Error calculating risk score", description: err.message, variant: "destructive" });
    },
  });
}

export function useBatchRiskScore() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (equipmentIds: number[]) => {
      const res = await fetch(api.riskScore.batch.path, {
        method: api.riskScore.batch.method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ equipmentIds }),
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to calculate batch risk scores");
      return api.riskScore.batch.responses[200].parse(await res.json());
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['risk-scores'] });
      toast({ title: "Batch risk scores calculated successfully" });
    },
    onError: (err) => {
      toast({ title: "Error calculating batch risk scores", description: err.message, variant: "destructive" });
    },
  });
}

export function useRiskScoreHistory(equipmentId: number) {
  return useQuery({
    queryKey: ['risk-scores', 'history', equipmentId],
    queryFn: async () => {
      const url = buildUrl(api.riskScore.history.path, { id: equipmentId });
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch risk score history");
      return api.riskScore.history.responses[200].parse(await res.json());
    },
    enabled: !!equipmentId,
  });
}

export function useMultiHorizonRiskScores() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: scores = [] } = useQuery<any[]>({
    queryKey: ['risk-scores', 'multi-horizon'],
    queryFn: () => queryClient.getQueryData<any[]>(['risk-scores', 'multi-horizon']) ?? [],
    staleTime: Infinity,
    gcTime: 30 * 60 * 1000,
  });

  const mutation = useMutation({
    mutationFn: async (equipmentIds: number[]) => {
      const res = await fetch('/api/risk-score/multi-horizon/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ equipmentIds }),
      });
      if (!res.ok) throw new Error('Failed to calculate multi-horizon risk scores');
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.setQueryData(['risk-scores', 'multi-horizon'], data);
    },
    onError: (err: Error) => {
      toast({
        title: 'Risk score calculation failed',
        description: err.message,
        variant: 'destructive',
      });
    },
  });

  return { scores, mutation };
}

export function useLatestMultiHorizonPredictions() {
  return useQuery({
    queryKey: ['/api/risk-score/multi-horizon/latest'],
    queryFn: async () => {
      const res = await fetch('/api/risk-score/multi-horizon/latest', {
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Failed to fetch predictions');
      return res.json();
    },
  });
}