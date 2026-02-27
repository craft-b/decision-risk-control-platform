// server/services/sensor-simulator.ts
// Simulates realistic sensor readings for construction equipment.
// Used to generate historical training data for the ML pipeline.

import { SensorReading } from './data-logger';

interface EquipmentState {
  equipmentId: number;
  category: string;
  currentHours: number;
  ageYears: number;
  healthScore: number;          // 0–1, degrades over time
  lastMaintenanceHours: number;
  vibrationBaseline: number;
  tempBaseline: number;
}

const CATEGORY_PROFILES: Record<string, {
  rpmRange: [number, number];
  tempRange: [number, number];
  oilPressureRange: [number, number];
  hydraulicRange: [number, number];
  vibrationBaseline: number;
}> = {
  'Excavator':  { rpmRange: [1200, 2200], tempRange: [75, 95],  oilPressureRange: [40, 60], hydraulicRange: [180, 220], vibrationBaseline: 0.15 },
  'Dozer':      { rpmRange: [1000, 1800], tempRange: [80, 100], oilPressureRange: [45, 65], hydraulicRange: [160, 200], vibrationBaseline: 0.20 },
  'Loader':     { rpmRange: [1100, 2000], tempRange: [75, 95],  oilPressureRange: [40, 60], hydraulicRange: [170, 210], vibrationBaseline: 0.12 },
  'Crane':      { rpmRange: [800,  1600], tempRange: [70, 90],  oilPressureRange: [35, 55], hydraulicRange: [150, 200], vibrationBaseline: 0.08 },
  'Compactor':  { rpmRange: [1500, 2500], tempRange: [70, 90],  oilPressureRange: [40, 55], hydraulicRange: [140, 180], vibrationBaseline: 0.35 },
  'Default':    { rpmRange: [1000, 2000], tempRange: [75, 95],  oilPressureRange: [40, 60], hydraulicRange: [160, 200], vibrationBaseline: 0.15 },
};

const MODE_MULTIPLIERS: Record<string, number> = {
  IDLE:   0.3,
  LIGHT:  0.6,
  NORMAL: 1.0,
  HEAVY:  1.4,
};

class SensorSimulator {
  private states = new Map<number, EquipmentState>();

  async initializeEquipmentState(
    equipmentId: number,
    category: string,
    currentHours: number,
    ageYears: number
  ): Promise<void> {
    const profile = CATEGORY_PROFILES[category] || CATEGORY_PROFILES['Default'];

    // Health degrades with age and hours
    const ageDegradation   = Math.min(ageYears / 15, 0.4);
    const hoursDegradation = Math.min(currentHours / 10000, 0.4);
    const healthScore = Math.max(0.2, 1 - ageDegradation - hoursDegradation);

    this.states.set(equipmentId, {
      equipmentId,
      category: category || 'Default',
      currentHours,
      ageYears,
      healthScore,
      lastMaintenanceHours: currentHours - Math.random() * 200,
      vibrationBaseline: profile.vibrationBaseline * (1 + (1 - healthScore)),
      tempBaseline:      (profile.tempRange[0] + profile.tempRange[1]) / 2,
    });
  }

  generateReading(
    equipmentId: number,
    mode: 'IDLE' | 'LIGHT' | 'NORMAL' | 'HEAVY' = 'NORMAL',
    hoursElapsed: number = 1 / 12
  ): SensorReading {
    const state = this.states.get(equipmentId);
    if (!state) {
      throw new Error(`Equipment ${equipmentId} not initialized — call initializeEquipmentState first`);
    }

    const profile = CATEGORY_PROFILES[state.category] || CATEGORY_PROFILES['Default'];
    const multiplier = MODE_MULTIPLIERS[mode] || 1.0;
    const degradation = 1 - state.healthScore;

    // Advance operating hours
    state.currentHours += hoursElapsed;

    // Gradually degrade health
    state.healthScore = Math.max(0.1, state.healthScore - 0.00001 * hoursElapsed * multiplier);

    const noise = () => (Math.random() - 0.5) * 0.1;

    const rpm = Math.floor(
      (profile.rpmRange[0] + (profile.rpmRange[1] - profile.rpmRange[0]) * multiplier)
      * (1 + noise())
    );

    const engineTemperature = state.tempBaseline
      * multiplier
      * (1 + degradation * 0.2)
      * (1 + noise() * 0.05);

    const oilPressure = (
      (profile.oilPressureRange[0] + profile.oilPressureRange[1]) / 2
      * (1 - degradation * 0.15)
      * (1 + noise() * 0.05)
    );

    const hydraulicPressure = (
      (profile.hydraulicRange[0] + profile.hydraulicRange[1]) / 2
      * multiplier
      * (1 - degradation * 0.1)
      * (1 + noise() * 0.05)
    );

    const vibrationLevel = (
      state.vibrationBaseline
      * multiplier
      * (1 + degradation * 0.5)
      * (1 + Math.random() * 0.3)
    );

    const fuelConsumption = 15 * multiplier * (1 + degradation * 0.1) * (1 + noise() * 0.1);
    const loadFactor = Math.min(multiplier * (0.7 + noise() * 0.2), 1.0);

    // Warnings and errors increase with degradation
    const warningFlag = Math.random() < degradation * 0.05 ? 1 : 0;
    const errorCode   = Math.random() < degradation * 0.01 ? `E${Math.floor(Math.random() * 900 + 100)}` : undefined;

    return {
      equipmentId,
      timestamp:         new Date(),
      operatingHours:    Math.round(state.currentHours * 100) / 100,
      engineTemperature: Math.round(engineTemperature * 10) / 10,
      oilPressure:       Math.round(oilPressure * 10) / 10,
      hydraulicPressure: Math.round(hydraulicPressure * 10) / 10,
      vibrationLevel:    Math.round(vibrationLevel * 1000) / 1000,
      fuelConsumption:   Math.round(fuelConsumption * 10) / 10,
      loadFactor:        Math.round(loadFactor * 1000) / 1000,
      rpmLevel:          rpm,
      warningFlag,
      errorCode,
      operatingMode:     mode,
    };
  }

  performMaintenance(equipmentId: number, type: string): void {
    const state = this.states.get(equipmentId);
    if (!state) return;

    const restoreAmount = type === 'MAJOR_SERVICE' ? 0.25
      : type === 'MINOR_SERVICE' ? 0.10
      : 0.05;

    state.healthScore = Math.min(1.0, state.healthScore + restoreAmount);
    state.lastMaintenanceHours = state.currentHours;
    state.vibrationBaseline = (CATEGORY_PROFILES[state.category] || CATEGORY_PROFILES['Default'])
      .vibrationBaseline * (1 + (1 - state.healthScore) * 0.5);
  }

  getHealthStatus(equipmentId: number): EquipmentState | undefined {
    return this.states.get(equipmentId);
  }

  clearAll(): void {
    this.states.clear();
  }
}

export const sensorSimulator = new SensorSimulator();