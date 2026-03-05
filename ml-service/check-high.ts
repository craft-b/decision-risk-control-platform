import { db } from "./server/db.js";
const result = await db.execute(`
  SELECT e.equipment_id, e.name, r.risk_band, r.failure_probability, r.predicted_at
  FROM asset_risk_predictions r
  JOIN equipment e ON e.id = r.equipment_id
  WHERE r.risk_band = 'HIGH'
  AND r.predicted_at = (SELECT MAX(predicted_at) FROM asset_risk_predictions r2 WHERE r2.equipment_id = r.equipment_id)
  ORDER BY r.failure_probability DESC
`);
console.log(JSON.stringify(result[0], null, 2));
process.exit(0);
