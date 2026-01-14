import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";

interface ModelMetrics {
  version: string;
  trainedAt: string;
  datasetSize: number;
  accuracy: number;
  precision: {
    HIGH: number;
    MEDIUM: number;
    LOW: number;
  };
  recall: {
    HIGH: number;
    MEDIUM: number;
    LOW: number;
  };
  f1Score: {
    HIGH: number;
    MEDIUM: number;
    LOW: number;
  };
  confusionMatrix: {
    HIGH: { predictedHIGH: number; predictedMEDIUM: number; predictedLOW: number };
    MEDIUM: { predictedHIGH: number; predictedMEDIUM: number; predictedLOW: number };
    LOW: { predictedHIGH: number; predictedMEDIUM: number; predictedLOW: number };
  };
  featureImportance: Array<{
    feature: string;
    importance: number;
    description: string;
  }>;
  predictionHistory: Array<{
    date: string;
    total: number;
    high: number;
    medium: number;
    low: number;
  }>;
  hyperparameters: {
    algorithm: string;
    nEstimators: number;
    maxDepth: number;
    minSamplesSplit: number;
    classWeight: string;
  };
}


export interface RiskPrediction {
  equipmentId: number;
  failureProbability: number;
  riskBand: "LOW" | "MEDIUM" | "HIGH";
  topDrivers: Array<{
    feature: string;
    impact: number;
    description: string;
  }>;
  snapshotTs: Date;
  modelVersion: string;
  recommendation: string;
}

export interface FleetRiskDistribution {
  low: number;
  medium: number;
  high: number;
  total: number;
}

export interface EquipmentWithRisk {
  id: number;
  equipmentId: string;
  name: string;
  category: string;
  status: string;
  risk: {
    riskBand: "LOW" | "MEDIUM" | "HIGH";
    failureProbability: number;
    recommendation: string;
    predictedAt: Date;
    topDrivers: Array<{
      feature: string;
      impact: number;
      description: string;
    }>;
  } | null;
}

// Get risk prediction for single equipment
export function useEquipmentRisk(equipmentId: number) {
  return useQuery<RiskPrediction>({
    queryKey: ['/api/equipment/:id/risk', equipmentId],
    queryFn: async () => {
      const res = await fetch(`/api/equipment/${equipmentId}/risk`, { 
        credentials: "include" 
      });
      if (!res.ok) throw new Error("Failed to fetch risk prediction");
      return res.json();
    },
    enabled: !!equipmentId,
  });
}

// Get fleet risk distribution
export function useFleetRisk() {
  return useQuery<FleetRiskDistribution>({
    queryKey: ['/api/predictive-maintenance/fleet-risk'],
    queryFn: async () => {
      const res = await fetch('/api/predictive-maintenance/fleet-risk', { 
        credentials: "include" 
      });
      if (!res.ok) throw new Error("Failed to fetch fleet risk");
      return res.json();
    },
  });
}

// Get equipment list with risk scores
export function useEquipmentWithRisk() {
  return useQuery<EquipmentWithRisk[]>({
    queryKey: ['/api/predictive-maintenance/equipment-with-risk'],
    queryFn: async () => {
      const res = await fetch('/api/predictive-maintenance/equipment-with-risk', { 
        credentials: "include" 
      });
      if (!res.ok) throw new Error("Failed to fetch equipment with risk");
      return res.json();
    },
  });
}

// Run batch predictions (admin only)
export function useRunPredictions() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/predictive-maintenance/predict-all', {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to run predictions");
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['/api/predictive-maintenance/fleet-risk'] });
      queryClient.invalidateQueries({ queryKey: ['/api/predictive-maintenance/equipment-with-risk'] });
      toast({ 
        title: "Predictions Complete", 
        description: `Generated ${data.count} risk predictions` 
      });
    },
    onError: (err) => {
      toast({ 
        title: "Prediction Failed", 
        description: err.message, 
        variant: "destructive" 
      });
    },
  });
}

// Generate feature snapshots (admin only)
export function useGenerateSnapshots() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (snapshotDate?: Date) => {
      const res = await fetch('/api/predictive-maintenance/generate-snapshots', {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          snapshotDate: snapshotDate?.toISOString() 
        }),
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to generate snapshots");
      return res.json();
    },
    onSuccess: (data) => {
      toast({ 
        title: "Snapshots Generated", 
        description: `Created ${data.count} feature snapshots` 
      });
    },
    onError: (err) => {
      toast({ 
        title: "Snapshot Generation Failed", 
        description: err.message, 
        variant: "destructive" 
      });
    },
  });
}

// Label historical snapshots (admin only)
export function useLabelSnapshots() {
  const { toast } = useToast();

  return useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/predictive-maintenance/label-snapshots', {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to label snapshots");
      return res.json();
    },
    onSuccess: (data) => {
      toast({ 
        title: "Snapshots Labeled", 
        description: `Labeled ${data.count} historical snapshots for training` 
      });
    },
    onError: (err) => {
      toast({ 
        title: "Labeling Failed", 
        description: err.message, 
        variant: "destructive" 
      });
    },
  });
}

export function useModelMetrics() {
  return useQuery<ModelMetrics>({
    queryKey: ['/api/ml/model-metrics'],
    queryFn: async () => {
      const response = await fetch('/api/ml/model-metrics', {
        credentials: 'include',
      });
      
      if (!response.ok) {
        throw new Error('Failed to fetch model metrics');
      }
      
      return response.json();
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
    refetchOnWindowFocus: false,
  });
}

export function useFeatureImportance() {
  return useQuery({
    queryKey: ['/api/ml/feature-importance'],
    queryFn: async () => {
      const response = await fetch('/api/ml/feature-importance', {
        credentials: 'include',
      });
      
      if (!response.ok) {
        throw new Error('Failed to fetch feature importance');
      }
      
      return response.json();
    },
    staleTime: 10 * 60 * 1000, // 10 minutes
  });
}

export function usePipelineStatus() {
  return useQuery({
    queryKey: ['/api/ml/pipeline-status'],
    queryFn: async () => {
      const res = await fetch('/api/ml/pipeline-status', {
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Failed to fetch pipeline status');
      return res.json();
    },
    refetchInterval: 30000, // Refresh every 30 seconds
  });
}