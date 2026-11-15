'use strict';

// The scenery map's maths: where things land, how far the view can go, and
// how markers group.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const load = () =>
  import(require('node:url').pathToFileURL(path.join(__dirname, '..', 'ui', 'lib', 'map.mjs')));

const W = 1200;
const H = 700;

function pkg(id, airports, conflicts = []) {
  return { id, title: id, airports, conflicts };
}

test('the projection puts known places where they belong', async () => {
  const { project, WORLD } = await load();
  assert.deepEqual(project(0, 0).map((v) => Math.round(v)), [WORLD / 2, WORLD / 2]);
  const [lonLondon, latLondon] = project(51.47, -0.45);
  const [lonSydney, latSydney] = project(-33.9, 151.2);
  assert.ok(lonSydney > lonLondon, 'east is right');
  assert.ok(latSydney > latLondon, 'south is down');
});

test('polar latitudes never produce an unusable coordinate', async () => {
  const { project } = await load();
  for (const lat of [90, -90, 89.9999]) assert.ok(Number.isFinite(project(lat, 0)[1]), String(lat));
});

test('the view can never show empty space or zoom past its limits', async () => {
  const { clampView, fitWorld, minScale, MAX_ZOOM, WORLD } = await load();
  const start = fitWorld(W, H);
  assert.ok(start.x <= 0 && start.x + WORLD * start.k >= W);

  const out = clampView({ k: 0.001, x: 5000, y: 5000 }, W, H);
  assert.equal(out.k, minScale(W, H));
  assert.ok(out.x <= 0);

  const deep = clampView({ k: 1e6, x: 0, y: 0 }, W, H);
  assert.equal(deep.k, minScale(W, H) * MAX_ZOOM);
});

test('zooming keeps the point under the cursor in place', async () => {
  const { fitWorld, zoomAt } = await load();
  const start = fitWorld(W, H);
  const [px, py] = [600, 350];
  const before = [(px - start.x) / start.k, (py - start.y) / start.k];
  const next = zoomAt(start, 2, px, py, W, H);
  const after = [(px - next.x) / next.k, (py - next.y) / next.k];
  assert.ok(Math.abs(before[0] - after[0]) < 1e-6);
  assert.ok(Math.abs(before[1] - after[1]) < 1e-6);
});

test('every airport of every package becomes a point; packages with none add nothing', async () => {
  const { mapPoints } = await load();
  const points = mapPoints([
    pkg('pair', [{ ident: 'VNKL', lat: 27.6, lon: 86.7 }, { ident: 'VNPL', lat: 27.5, lon: 86.6 }]),
    pkg('landmarks', []),
  ]);
  assert.equal(points.length, 2);
  assert.notEqual(points[0].key, points[1].key, 'keys must be unique for React');
});

test('markers merge when zoomed out and separate when zoomed in', async () => {
  const { clusterPoints, mapPoints } = await load();
  const points = mapPoints([
    pkg('a', [{ ident: 'KJFK', lat: 40.64, lon: -73.78 }]),
    pkg('b', [{ ident: 'KLGA', lat: 40.78, lon: -73.87 }]),
  ]);
  assert.equal(clusterPoints(points, 1).length, 1);
  assert.equal(clusterPoints(points, 2000).length, 2);
});

test('a conflict stays visible when its marker is inside a cluster', async () => {
  const { clusterPoints, mapPoints } = await load();
  const points = mapPoints([
    pkg('calm', [{ ident: 'WADD', lat: -8.74, lon: 115.16 }]),
    pkg('clash', [{ ident: 'WAAA', lat: -8.7, lon: 115.2 }], [{}]),
  ]);
  const [cluster] = clusterPoints(points, 1);
  assert.equal(cluster.conflict, true);
});

test('a click opens, zooms, or lists, depending on what is under it', async () => {
  const { clusterAction, clusterPoints, fitWorld, mapPoints } = await load();
  const view = fitWorld(W, H);
  const same = { ident: 'WADD', lat: -8.7448, lon: 115.1654 };

  const one = clusterPoints(mapPoints([pkg('a', [same])]), view.k)[0];
  assert.equal(clusterAction(one, view, W, H), 'open');

  // Two add-ons at one airport never separate, so zooming would be a dead end.
  const stacked = clusterPoints(mapPoints([pkg('a', [same]), pkg('b', [same])]), view.k)[0];
  assert.equal(clusterAction(stacked, view, W, H), 'list');

  const spread = clusterPoints(
    mapPoints([pkg('a', [{ lat: 40.6, lon: -73.8 }]), pkg('b', [{ lat: 40.8, lon: -73.9 }])]),
    view.k,
  )[0];
  assert.equal(clusterAction(spread, view, W, H), 'zoom');
});

test('fitting a cluster frames all of its points', async () => {
  const { fitPoints, mapPoints } = await load();
  const points = mapPoints([pkg('a', [{ lat: 40.6, lon: -73.8 }]), pkg('b', [{ lat: 34, lon: -118.4 }])]);
  const view = fitPoints(points, W, H);
  for (const point of points) {
    const x = point.wx * view.k + view.x;
    const y = point.wy * view.k + view.y;
    assert.ok(x >= 0 && x <= W && y >= 0 && y <= H, `${x},${y}`);
  }
});

test('a shape crossing the 180 meridian never draws a line across the map', async () => {
  const { ringsToPath, WORLD } = await load();
  const ring = [[179, 60], [-179, 60], [-179, 62], [179, 62], [179, 60]];
  const path = ringsToPath([ring]);
  const shapes = path.split('Z').filter(Boolean);
  assert.equal(shapes.length, 2, 'one piece at each edge of the world');
  for (const shape of shapes) {
    const xs = shape.split(/[ML]/).filter(Boolean).map((step) => Number(step.split(' ')[0]));
    assert.ok(Math.max(...xs) - Math.min(...xs) < WORLD / 100, shape);
  }
});

test('the crossing is handled whichever side a shape starts on', async () => {
  const { ringsToPath } = await load();
  const ring = [[-179, 60], [179, 60], [179, 62], [-179, 62], [-179, 60]];
  assert.equal(ringsToPath([ring]).split('Z').filter(Boolean).length, 2);
});

test('a shape that stays on one side is drawn once', async () => {
  const { ringsToPath } = await load();
  const path = ringsToPath([[[10, 10], [20, 10], [20, 20], [10, 10]]]);
  assert.equal(path.split('Z').filter(Boolean).length, 1);
});

test('a ring round the whole pole is left out rather than smeared across the map', async () => {
  const { ringsToPath } = await load();
  assert.equal(ringsToPath([[[-180, -70], [-60, -70], [60, -70], [179, -70], [-179, -70]]]), '');
});

test('border lines lift the pen at the 180 meridian', async () => {
  const { linesToPath } = await load();
  const path = linesToPath([[[179, 60], [-179, 60]]]);
  assert.equal(path.match(/M/g).length, 2);
  assert.equal(path.match(/L/g), null);
});

test('the airport list always stays inside the map', async () => {
  const { PICKER_WIDTH, pickerPlace } = await load();
  for (const [x, y] of [[0, 0], [W, 0], [0, H], [W, H], [600, 350]]) {
    for (const [count, tall] of [[2, 70], [40, 240]]) {
      const [left, top] = pickerPlace(x, y, count, W, H);
      assert.ok(left >= 0 && left + PICKER_WIDTH <= W, `left ${left}`);
      assert.ok(top >= 0 && top + tall <= H, `top ${top}`);
    }
  }
});
