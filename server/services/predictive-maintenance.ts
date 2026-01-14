// server/services/predictive-maintenance.ts

import { db } from "../db";
import { assetRiskPredictions, equipment } from "@shared/schema";
import { eq, desc } from "drizzle-orm";
import { featureEngineeringService, FeatureSnapshot } from "./feature-engineering";

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

class PredictiveMaintenanceService {
  /**
   * Rule-based risk scoring (MVP - before ML model)
   * Simple heuristic model based on domain knowledge
   */
  calculateRuleBasedRisk(snapshot: FeatureSnapshot): RiskPrediction {
    let riskScore = 0;
    const drivers: Array<{ feature: string; impact: number; description: string }> = [];
    
    // Rule 1: High maintenance frequency
    if (snapshot.maintenanceEvents90d >= 3) {
      const impact = 0.25;
      riskScore += impact;
      drivers.push({
        feature: "maintenanceEvents90d",
        impact,
        description: `${snapshot.maintenanceEvents90d} maintenance events in last 90 days (>3 indicates issues)`,
      });
    }
    
    // Rule 2: Days since last maintenance
    if (snapshot.daysSinceLastMaintenance !== null && snapshot.daysSinceLastMaintenance > 120) {
      const impact = 0.20;
      riskScore += impact;
      drivers.push({
        feature: "daysSinceLastMaintenance",
        impact,
        description: `${snapshot.daysSinceLastMaintenance} days since last maintenance (>120 days overdue)`,
      });
    }
    
    // Rule 3: High usage intensity
    if (snapshot.rentalDays90d > 60) {
      const impact = 0.15;
      riskScore += impact;
      drivers.push({
        feature: "rentalDays90d",
        impact,
        description: `Heavy usage: ${snapshot.rentalDays90d} rental days in last 90 days`,
      });
    }
    
    // Rule 4: Asset age
    if (snapshot.assetAgeYears > 5) {
      const impact = 0.10 * (snapshot.assetAgeYears - 5);
      riskScore += impact;
      drivers.push({
        feature: "assetAgeYears",
        impact,
        description: `Asset is ${snapshot.assetAgeYears.toFixed(1)} years old`,
      });
    }
    
    // Rule 5: High maintenance costs
    if (snapshot.maintenanceCost180d > 1000) {
      const impact = 0.15;
      riskScore += impact;
      drivers.push({
        feature: "maintenanceCost180d",
        impact,
        description: `High maintenance costs: $${snapshot.maintenanceCost180d.toFixed(2)} in last 180 days`,
      });
    }
    
    // Normalize to 0-1 range
    const failureProbability = Math.min(riskScore, 1.0);
    
    // Determine risk band
    let riskBand: "LOW" | "MEDIUM" | "HIGH";
    if (failureProbability < 0.30) {
      riskBand = "LOW";
    } else if (failureProbability < 0.60) {
      riskBand = "MEDIUM";
    } else {
      riskBand = "HIGH";
    }
    
    // Sort drivers by impact
    drivers.sort((a, b) => b.impact - a.impact);
    
    // Generate recommendation
    let recommendation: string;
    if (riskBand === "HIGH") {
      recommendation = "Schedule service within 14 days - high failure risk detected";
    } else if (riskBand === "MEDIUM") {
      recommendation = "Schedule inspection within 30 days";
    } else {
      recommendation = "No immediate action required";
    }
    
    return {
      equipmentId: snapshot.equipmentId,
      failureProbability,
      riskBand,
      topDrivers: drivers.slice(0, 3), // Top 3 drivers
      snapshotTs: snapshot.snapshotTs,
      modelVersion: "v1.0-rule-based",
      recommendation,
    };
  }
  
  /**
   * Predict risk for a single equipment asset
   */
  async predictRisk(equipmentId: number): Promise<RiskPrediction> {
    // Generate current feature snapshot
    const snapshot = await featureEngineeringService.generateSnapshot(
      equipmentId,
      new Date()
    );
    
    // Calculate risk using rule-based model
    const prediction = this.calculateRuleBasedRisk(snapshot);
    
    // Save prediction to database
    await this.savePrediction(prediction);
    
    return prediction;
  }
  
  /**
   * Batch prediction for all equipment
   */
  async predictAllEquipment(): Promise<RiskPrediction[]> {
    const allEquipment = await db.select({ id: equipment.id }).from(equipment);
    
    const predictions: RiskPrediction[] = [];
    
    for (const equip of allEquipment) {
      try {
        const prediction = await this.predictRisk(equip.id);
        predictions.push(prediction);
      } catch (error) {
        console.error(`Failed to predict risk for equipment ${equip.id}:`, error);
      }
    }
    
    return predictions;
  }
  
  /**
   * Save prediction to database
   */
  async savePrediction(prediction: RiskPrediction): Promise<void> {
    await db.insert(assetRiskPredictions).values({
      equipmentId: prediction.equipmentId,
      snapshotTs: prediction.snapshotTs,
      failureProbability: prediction.failureProbability.toFixed(4),
      riskBand: prediction.riskBand,
      topDriver1: prediction.topDrivers[0]?.feature || null,
      topDriver1Impact: prediction.topDrivers[0]?.impact.toFixed(4) || null,
      topDriver2: prediction.topDrivers[1]?.feature || null,
      topDriver2Impact: prediction.topDrivers[1]?.impact.toFixed(4) || null,
      topDriver3: prediction.topDrivers[2]?.feature || null,
      topDriver3Impact: prediction.topDrivers[2]?.impact.toFixed(4) || null,
      modelVersion: prediction.modelVersion,
    });
  }
  
  /**
   * Get latest prediction for equipment
   */
  async getLatestPrediction(equipmentId: number): Promise<RiskPrediction | null> {
    const [prediction] = await db
      .select()
      .from(assetRiskPredictions)
      .where(eq(assetRiskPredictions.equipmentId, equipmentId))
      .orderBy(desc(assetRiskPredictions.predictedAt))
      .limit(1);
    
    if (!prediction) {
      return null;
    }
    
    const topDrivers = [
      prediction.topDriver1 && {
        feature: prediction.topDriver1,
        impact: Number(prediction.topDriver1Impact),
        description: this.getDriverDescription(prediction.topDriver1),
      },
      prediction.topDriver2 && {
        feature: prediction.topDriver2,
        impact: Number(prediction.topDriver2Impact),
        description: this.getDriverDescription(prediction.topDriver2),
      },
      prediction.topDriver3 && {
        feature: prediction.topDriver3,
        impact: Number(prediction.topDriver3Impact),
        description: this.getDriverDescription(prediction.topDriver3),
      },
    ].filter(Boolean) as Array<{ feature: string; impact: number; description: string }>;
    
    let recommendation: string;
    if (prediction.riskBand === "HIGH") {
      recommendation = "Schedule service within 14 days - high failure risk detected";
    } else if (prediction.riskBand === "MEDIUM") {
      recommendation = "Schedule inspection within 30 days";
    } else {
      recommendation = "No immediate action required";
    }
    
    return {
      equipmentId: prediction.equipmentId,
      failureProbability: Number(prediction.failureProbability),
      riskBand: prediction.riskBand as "LOW" | "MEDIUM" | "HIGH",
      topDrivers,
      snapshotTs: new Date(prediction.snapshotTs),
      modelVersion: prediction.modelVersion,
      recommendation,
    };
  }
  
  /**
   * Get human-readable driver description
   */
  private getDriverDescription(featureName: string): string {
    const descriptions: Record<string, string> = {
      maintenanceEvents90d: "Frequent recent maintenance events",
      daysSinceLastMaintenance: "Overdue for scheduled maintenance",
      rentalDays90d: "High usage intensity",
      assetAgeYears: "Asset aging factor",
      maintenanceCost180d: "Elevated maintenance costs",
    };
    
    return descriptions[featureName] || featureName;
  }
  
  /**
   * Get risk distribution across fleet
   */
  async getFleetRiskDistribution(): Promise<{
    low: number;
    medium: number;
    high: number;
    total: number;
  }> {
    // Get latest prediction for each equipment
    const latestPredictions = await db
      .select()
      .from(assetRiskPredictions)
      .orderBy(desc(assetRiskPredictions.predictedAt));
    
    // Deduplicate by equipment (keep latest)
    const uniquePredictions = new Map();
    for (const pred of latestPredictions) {
      if (!uniquePredictions.has(pred.equipmentId)) {
        uniquePredictions.set(pred.equipmentId, pred);
      }
    }
    
    const predictions = Array.from(uniquePredictions.values());
    
    return {
      low: predictions.filter(p => p.riskBand === "LOW").length,
      medium: predictions.filter(p => p.riskBand === "MEDIUM").length,
      high: predictions.filter(p => p.riskBand === "HIGH").length,
      total: predictions.length,
    };
  }
}

export const predictiveMaintenanceService = new PredictiveMaintenanceService();