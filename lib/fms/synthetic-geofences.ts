/**
 * SYNTHETIC test geofences for FMS Phase 3A PRE-POC.
 *
 * ⚠️ ALL GEOFENCES HERE ARE SYNTHETIC — NOT REAL MINE COORDINATES.
 * These are placed near the simulator's GPS origin for testing purposes only.
 * Real geofences will be configured from actual mine survey data.
 *
 * Simulator origin: EX-501 starts at (-3.01643, 121.85414)
 * Each tick: lat += 0.00002, lon += 0.00003
 */

import type { Client } from "pg";
import { createGeofence, type Geofence } from "./geofence-engine";

export const SYNTHETIC_GEOFENCES: Geofence[] = [
  {
    geofence_id: "SYN-LP-001",
    name: "SYNTHETIC Loading Point Alpha",
    type: "LOADING_POINT",
    site: "SYNTHETIC-PREPOC",
    // ~60m × 80m rectangle around simulator start
    geometry_wkt:
      "POLYGON((121.8538 -3.0167, 121.8545 -3.0167, 121.8545 -3.0162, 121.8538 -3.0162, 121.8538 -3.0167))",
    active: true,
  },
  {
    geofence_id: "SYN-DP-001",
    name: "SYNTHETIC Dumping Point Bravo",
    type: "DUMPING_POINT",
    site: "SYNTHETIC-PREPOC",
    // ~60m × 80m rectangle ~300m southeast
    geometry_wkt:
      "POLYGON((121.8543 -3.0160, 121.8550 -3.0160, 121.8550 -3.0155, 121.8543 -3.0155, 121.8543 -3.0160))",
    active: true,
  },
  {
    geofence_id: "SYN-HR-001",
    name: "SYNTHETIC Hauling Road Charlie",
    type: "HAULING_ROAD",
    site: "SYNTHETIC-PREPOC",
    // Narrow corridor connecting LP to DP
    geometry_wkt:
      "POLYGON((121.8540 -3.0167, 121.8543 -3.0167, 121.8547 -3.0160, 121.8544 -3.0160, 121.8540 -3.0167))",
    active: true,
  },
];

/**
 * Insert all synthetic geofences into the database.
 */
export async function seedSyntheticGeofences(client: Client): Promise<void> {
  for (const gf of SYNTHETIC_GEOFENCES) {
    await createGeofence(client, gf);
  }
}

/**
 * Remove all synthetic geofences and their events (for cleanup).
 */
export async function cleanupSyntheticGeofences(client: Client): Promise<void> {
  await client.query(`DELETE FROM fms_geofence_events WHERE geofence_id LIKE 'SYN-%'`);
  await client.query(`DELETE FROM fms_geofences WHERE geofence_id LIKE 'SYN-%'`);
}
