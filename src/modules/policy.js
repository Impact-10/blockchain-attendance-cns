const CLASSROOM_POLYGON = [
  { lat: 28.6135, lng: 77.2089 },
  { lat: 28.6135, lng: 77.2103 },
  { lat: 28.6124, lng: 77.2103 },
  { lat: 28.6124, lng: 77.2089 }
];

function normalizePolygonPoint(point) {
  if (!point || typeof point !== "object") {
    return null;
  }

  const lat = Number(point.lat);
  const lng = Number(point.lng ?? point.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return null;
  }

  return { lat, lng };
}

function sanitizePolygon(polygon) {
  if (!Array.isArray(polygon)) {
    return [];
  }
  return polygon.map(normalizePolygonPoint).filter(Boolean);
}

function isPointInsidePolygon(point, polygon) {
  if (!Array.isArray(polygon) || polygon.length < 3) {
    return false;
  }

  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].lat;
    const yi = polygon[i].lng;
    const xj = polygon[j].lat;
    const yj = polygon[j].lng;

    const intersects = yi > point.lng !== yj > point.lng
      && point.lat < ((xj - xi) * (point.lng - yi)) / (yj - yi) + xi;

    if (intersects) {
      inside = !inside;
    }
  }
  return inside;
}

function isLocationAllowed(lat, lng, polygon = CLASSROOM_POLYGON) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return false;
  }

  const usablePolygon = sanitizePolygon(polygon);
  const finalPolygon = usablePolygon.length >= 3 ? usablePolygon : CLASSROOM_POLYGON;
  return isPointInsidePolygon({ lat, lng }, finalPolygon);
}

function normalizeIp(ipAddress) {
  if (!ipAddress) {
    return "";
  }
  const first = String(ipAddress).split(",")[0].trim();
  return first.replace("::ffff:", "");
}

function isHighCgpaStudent(state, studentId) {
  return state.highCgpaStudents.includes(studentId);
}

function isIpAllowedForHighCgpa(state, ipAddress) {
  return state.highCgpaAllowedIps.includes(ipAddress);
}

module.exports = {
  CLASSROOM_POLYGON,
  sanitizePolygon,
  isLocationAllowed,
  normalizeIp,
  isHighCgpaStudent,
  isIpAllowedForHighCgpa
};
