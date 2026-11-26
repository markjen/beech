import { Capacitor } from '@capacitor/core';

const options = { maximumAge: 3_600_000, timeout: 10_000, enableHighAccuracy: false };

/** Approximate location is sufficient to choose a nearby beach. */
export async function nearbyCoordinates(): Promise<{ latitude: number; longitude: number }> {
  if (Capacitor.getPlatform() === 'android' && Capacitor.isPluginAvailable('Geolocation')) {
    const { Geolocation } = await import('@capacitor/geolocation');
    // getCurrentPosition requests the manifest's coarse permission if needed.
    return (await Geolocation.getCurrentPosition(options)).coords;
  }
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition((position) => resolve(position.coords), reject, options);
  });
}
