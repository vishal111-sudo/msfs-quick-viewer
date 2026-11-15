// The maths behind the scenery map. Plain functions, so they can be tested
// without a browser (test/map.test.js).
//
// Web Mercator into a 1000 by 1000 "world" square. A view is { k, x, y }: k
// is screen pixels per world unit, x and y are the world origin on screen, so
// screen = world * k + offset.

export const WORLD = 1000;

// Shown latitude band. Mercator runs to infinity at the poles, and nobody has
// scenery in the part of Antarctica this leaves out of the initial frame.
const TOP_LATITUDE = 84;
const BOTTOM_LATITUDE = -60;
const CLAMP_LATITUDE = 85.05;

export const MAX_ZOOM = 64;

/** Past this zoom, airports are far enough apart to carry their code. */
export const LABEL_ZOOM = 5;

export function project(lat, lon) {
  const clamped = Math.max(-CLAMP_LATITUDE, Math.min(CLAMP_LATITUDE, lat));
  const phi = (clamped * Math.PI) / 180;
  const x = ((lon + 180) / 360) * WORLD;
  const y = ((1 - Math.log(Math.tan(Math.PI / 4 + phi / 2)) / Math.PI) / 2) * WORLD;
  return [x, y];
}

const bandTop = () => project(TOP_LATITUDE, 0)[1];
const bandBottom = () => project(BOTTOM_LATITUDE, 0)[1];

/** The scale at which the whole map exactly covers the window. */
export function minScale(width, height) {
  return Math.max(width / WORLD, height / (bandBottom() - bandTop()));
}

/** Keep the map covering the window: no zooming out past it, no empty edges. */
export function clampView(view, width, height) {
  const floor = minScale(width, height);
  const k = Math.max(floor, Math.min(floor * MAX_ZOOM, view.k));
  const x = Math.min(0, Math.max(width - WORLD * k, view.x));
  const y = Math.min(-bandTop() * k, Math.max(height - bandBottom() * k, view.y));
  return { k, x, y };
}

export function fitWorld(width, height) {
  const k = minScale(width, height);
  return clampView({ k, x: (width - WORLD * k) / 2, y: (height - (bandTop() + bandBottom()) * k) / 2 }, width, height);
}

/** Zoom by `factor`, keeping the world point under (px, py) where it is. */
export function zoomAt(view, factor, px, py, width, height) {
  const next = clampView({ ...view, k: view.k * factor }, width, height);
  const ratio = next.k / view.k;
  return clampView({ k: next.k, x: px - (px - view.x) * ratio, y: py - (py - view.y) * ratio }, width, height);
}

/** The view that frames these points, leaving room around them. */
export function fitPoints(points, width, height, padding = 80) {
  const xs = points.map((point) => point.wx);
  const ys = points.map((point) => point.wy);
  const [left, right] = [Math.min(...xs), Math.max(...xs)];
  const [top, bottom] = [Math.min(...ys), Math.max(...ys)];
  const spanX = Math.max(right - left, 0.01);
  const spanY = Math.max(bottom - top, 0.01);
  const k = Math.min((width - padding * 2) / spanX, (height - padding * 2) / spanY);
  const centre = (low, high, size, scale) => size / 2 - ((low + high) / 2) * scale;
  const capped = clampView({ k, x: 0, y: 0 }, width, height).k;
  return clampView({ k: capped, x: centre(left, right, width, capped), y: centre(top, bottom, height, capped) }, width, height);
}

/** One map point per airport of each package. */
export function mapPoints(packages) {
  const points = [];
  for (const pkg of packages) {
    for (const airport of pkg.airports) {
      const [wx, wy] = project(airport.lat, airport.lon);
      points.push({
        key: `${pkg.id}|${airport.lat}|${airport.lon}`,
        id: pkg.id,
        title: pkg.title,
        ident: airport.ident,
        lat: airport.lat,
        lon: airport.lon,
        wx,
        wy,
        conflict: pkg.conflicts.length > 0,
      });
    }
  }
  return points;
}

/**
 * Group points that would overlap at this scale. Greedy and in world space, so
 * panning never reshuffles them; only zooming does.
 *
 * @param {object[]} points from mapPoints()
 * @param {number} k current scale
 * @param {number} radius screen pixels within which points merge
 */
export function clusterPoints(points, k, radius = 26) {
  const reach = radius / k;
  const clusters = [];
  for (const point of points) {
    const near = clusters.find((cluster) => Math.hypot(cluster.wx - point.wx, cluster.wy - point.wy) < reach);
    if (near) {
      near.points.push(point);
      const n = near.points.length;
      near.wx += (point.wx - near.wx) / n;
      near.wy += (point.wy - near.wy) / n;
      near.conflict = near.conflict || point.conflict;
    } else {
      clusters.push({ key: point.key, wx: point.wx, wy: point.wy, conflict: point.conflict, points: [point] });
    }
  }
  return clusters;
}

/**
 * What clicking a cluster should do. Points that stay on top of each other at
 * any zoom (two add-ons for one airport) can only be picked from a list.
 */
export function clusterAction(cluster, view, width, height) {
  if (cluster.points.length === 1) return 'open';
  const ceiling = minScale(width, height) * MAX_ZOOM;
  const xs = cluster.points.map((point) => point.wx);
  const ys = cluster.points.map((point) => point.wy);
  const spread = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
  return spread * ceiling < 30 || view.k >= ceiling ? 'list' : 'zoom';
}

const PICKER_ROW = 30;
const PICKER_EDGE = 8;

export const PICKER_WIDTH = 320;
export const PICKER_HEIGHT = 240;

/** Where the airport list goes: beside its marker, always inside the frame. */
export function pickerPlace(x, y, count, width, height) {
  const tall = Math.min(count * PICKER_ROW + 10, PICKER_HEIGHT);
  const left = Math.max(PICKER_EDGE, Math.min(x - 13, width - PICKER_WIDTH - PICKER_EDGE));
  const below = y + 16;
  const top = below + tall + PICKER_EDGE > height ? Math.max(PICKER_EDGE, y - 16 - tall) : below;
  return [left, top];
}

const number = (value) => value.toFixed(2);

function drawRing(line, offset) {
  const steps = line.map(([lon, lat], index) => {
    const [x, y] = project(lat, lon);
    return `${index ? 'L' : 'M'}${number(x + offset)} ${number(y)}`;
  });
  return `${steps.join('')}Z`;
}

/** Carry longitudes past 180 so a shape crossing that meridian stays in one piece. */
function unroll(ring) {
  let shift = 0;
  return ring.map(([lon, lat], index) => {
    const step = index ? lon - ring[index - 1][0] : 0;
    if (step > 180) shift -= 360;
    if (step < -180) shift += 360;
    return [lon + shift, lat];
  });
}

/**
 * Closed rings of [lon, lat] to an SVG path in world units. The atlas has
 * shapes that cross the 180 meridian (Russia, Fiji) as single rings: drawn as
 * they are, each crossing is a line the width of the map. So they are drawn
 * unbroken, with a second copy for the part past the edge of the world.
 */
export function ringsToPath(rings) {
  let path = '';
  for (const ring of rings) {
    const line = unroll(ring);
    const lons = line.map(([lon]) => lon);
    // Only Antarctica goes all the way round, and it is below the shown band.
    if (Math.abs(lons[lons.length - 1] - lons[0]) > 180) continue;
    path += drawRing(line, 0);
    if (Math.min(...lons) < -180) path += drawRing(line, WORLD);
    if (Math.max(...lons) > 180) path += drawRing(line, -WORLD);
  }
  return path;
}

/** Open lines of [lon, lat] to an SVG path, lifting the pen across the 180 meridian. */
export function linesToPath(lines) {
  let path = '';
  for (const line of lines) {
    line.forEach(([lon, lat], index) => {
      const jump = index > 0 && Math.abs(lon - line[index - 1][0]) > 180;
      const [x, y] = project(lat, lon);
      path += `${index && !jump ? 'L' : 'M'}${number(x)} ${number(y)}`;
    });
  }
  return path;
}
