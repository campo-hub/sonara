export function roundCoordinates(latitude, longitude) {
  const lat = Number(latitude);
  const lng = Number(longitude);
  if (!Number.isFinite(lat) || lat < -90 || lat > 90
    || !Number.isFinite(lng) || lng < -180 || lng > 180) {
    return null;
  }
  return {
    type: 'Point',
    coordinates: [Number(lng.toFixed(2)), Number(lat.toFixed(2))]
  };
}
