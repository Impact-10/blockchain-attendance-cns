const CLASSROOM_POLYGON = [
  { lat: 28.6135, lng: 77.2089 },
  { lat: 28.6135, lng: 77.2103 },
  { lat: 28.6124, lng: 77.2103 },
  { lat: 28.6124, lng: 77.2089 }
];

const METERS_PER_DEGREE_LAT = 111320;

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

function orderPolygonClockwise(polygon) {
  const points = sanitizePolygon(polygon);
  if (points.length < 3) {
    return points;
  }

  const center = points.reduce(
    (acc, point) => ({
      lat: acc.lat + point.lat,
      lng: acc.lng + point.lng
    }),
    { lat: 0, lng: 0 }
  );

  center.lat /= points.length;
  center.lng /= points.length;

  return points
    .slice()
    .sort((a, b) => {
      const angleA = Math.atan2(a.lat - center.lat, a.lng - center.lng);
      const angleB = Math.atan2(b.lat - center.lat, b.lng - center.lng);
      return angleA - angleB;
    });
}

function toMeters(point, refLat) {
  const latScale = METERS_PER_DEGREE_LAT;
  const lngScale = METERS_PER_DEGREE_LAT * Math.cos((refLat * Math.PI) / 180);
  return {
    x: point.lng * lngScale,
    y: point.lat * latScale
  };
}

function distancePointToSegmentMeters(point, a, b) {
  const refLat = (point.lat + a.lat + b.lat) / 3;
  const p = toMeters(point, refLat);
  const p1 = toMeters(a, refLat);
  const p2 = toMeters(b, refLat);

  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  if (dx === 0 && dy === 0) {
    return Math.hypot(p.x - p1.x, p.y - p1.y);
  }

  const t = Math.max(0, Math.min(1, ((p.x - p1.x) * dx + (p.y - p1.y) * dy) / (dx * dx + dy * dy)));
  const projX = p1.x + t * dx;
  const projY = p1.y + t * dy;
  return Math.hypot(p.x - projX, p.y - projY);
}

function minDistanceToPolygonMeters(point, polygon) {
  let minDistance = Number.POSITIVE_INFINITY;
  for (let i = 0; i < polygon.length; i += 1) {
    const a = polygon[i];
    const b = polygon[(i + 1) % polygon.length];
    const distance = distancePointToSegmentMeters(point, a, b);
    if (distance < minDistance) {
      minDistance = distance;
    }
  }
  return minDistance;
}

function isPointInsidePolygon(point, polygon) {
  if (!Array.isArray(polygon) || polygon.length < 3) {
    return false;
  }

  const onEdge = minDistanceToPolygonMeters(point, polygon) <= 0.75;
  if (onEdge) {
    return true;
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

function isLocationAllowed(lat, lng, polygon = CLASSROOM_POLYGON, options = {}) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return false;
  }

  const accuracyMeters = Number(options.accuracyMeters);
  const baseBufferMeters = Number.isFinite(Number(options.baseBufferMeters)) ? Number(options.baseBufferMeters) : 4;
  const minBufferMeters = Number.isFinite(Number(options.minBufferMeters)) ? Number(options.minBufferMeters) : 5;
  const maxBufferMeters = Number.isFinite(Number(options.maxBufferMeters)) ? Number(options.maxBufferMeters) : 35;

  const usablePolygon = orderPolygonClockwise(polygon);
  const finalPolygon = usablePolygon.length >= 3 ? usablePolygon : CLASSROOM_POLYGON;
  const point = { lat, lng };

  if (isPointInsidePolygon(point, finalPolygon)) {
    return true;
  }

  const clampedAccuracy = Number.isFinite(accuracyMeters) ? Math.max(0, Math.min(accuracyMeters, maxBufferMeters)) : 0;
  const effectiveBuffer = Math.max(minBufferMeters, Math.min(maxBufferMeters, baseBufferMeters + clampedAccuracy));
  return minDistanceToPolygonMeters(point, finalPolygon) <= effectiveBuffer;
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
  orderPolygonClockwise,
  isLocationAllowed,
  normalizeIp,
  isHighCgpaStudent,
  isIpAllowedForHighCgpa
};
