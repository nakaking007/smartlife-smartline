function isUserInAlertArea(user, alert) {
  if (alert.latitude == null || alert.longitude == null) {
    return true;
  }

  const locations = alertLocationsForUser(user);
  if (locations.length === 0) {
    return false;
  }

  return locations.some((location) => {
    const distanceKm = distanceBetweenKm(
      location.latitude,
      location.longitude,
      alert.latitude,
      alert.longitude
    );

    return distanceKm <= (alert.radiusKm || 20);
  });
}

function alertLocationsForUser(user) {
  const locations = [];

  if (user.location?.latitude != null && user.location?.longitude != null) {
    locations.push(user.location);
  }

  for (const location of user.travelLocations || []) {
    if (location.active && location.latitude != null && location.longitude != null) {
      locations.push(location);
    }
  }

  return locations;
}

function distanceBetweenKm(lat1, lon1, lat2, lon2) {
  const earthRadiusKm = 6371;
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) *
      Math.cos(toRadians(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return earthRadiusKm * c;
}

function toRadians(value) {
  return (value * Math.PI) / 180;
}

module.exports = {
  alertLocationsForUser,
  isUserInAlertArea
};
