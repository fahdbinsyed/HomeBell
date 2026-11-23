import * as Location from 'expo-location';
import type { DeviceLocation } from '@homebell/contracts';

export type LocationResult =
  { ok: true; location: DeviceLocation } | { ok: false; reason: 'denied' | 'unavailable' };

/**
 * When-in-use location, requested just in time and only when the school's location rule is on.
 * Never background location (ADR-0017 §3).
 */
export async function getPickupLocation(): Promise<LocationResult> {
  try {
    const perm = await Location.requestForegroundPermissionsAsync();
    if (perm.status !== 'granted') return { ok: false, reason: 'denied' };
    const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
    return {
      ok: true,
      location: {
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        accuracyMeters: pos.coords.accuracy ?? 999,
        capturedAt: new Date(pos.timestamp).toISOString(),
      },
    };
  } catch {
    return { ok: false, reason: 'unavailable' };
  }
}
