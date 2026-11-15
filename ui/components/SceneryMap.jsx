import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { mesh, feature } from 'topojson-client';
import atlas from 'world-atlas/countries-50m.json';

import {
  LABEL_ZOOM,
  clampView,
  clusterAction,
  clusterPoints,
  fitPoints,
  fitWorld,
  mapPoints,
  linesToPath,
  minScale,
  pickerPlace,
  ringsToPath,
  zoomAt,
} from '../lib/map.mjs';

// Natural Earth, public domain, bundled so the map works with no connection.
// Built once: the geography never changes, only the view of it.
const LAND_PATH = ringsToPath(
  feature(atlas, atlas.objects.land).features.flatMap(({ geometry }) =>
    geometry.type === 'Polygon' ? geometry.coordinates : geometry.coordinates.flat(),
  ),
);
const BORDER_PATH = linesToPath(mesh(atlas, atlas.objects.countries, (a, b) => a !== b).coordinates);

const ZOOM_STEP = 1.6;

export function SceneryMap({ packages, onOpen }) {
  const frame = useRef(null);
  const [size, setSize] = useState(null);
  const [view, setView] = useState(null);
  const [picking, setPicking] = useState(null);
  const drag = useRef(null);

  // Measure before painting, and follow the window. Keeping the pixel size in
  // state rather than using a viewBox keeps markers one size at every zoom.
  useLayoutEffect(() => {
    const element = frame.current;
    const measure = () => {
      const { width, height } = element.getBoundingClientRect();
      if (!width || !height) return;
      setSize({ width, height });
      setView((current) => (current ? clampView(current, width, height) : fitWorld(width, height)));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const points = useMemo(() => mapPoints(packages), [packages]);
  const k = view ? view.k : 1;
  const clusters = useMemo(() => clusterPoints(points, k), [points, k]);

  useEffect(() => setPicking(null), [packages, k]);

  // Wheel needs a non-passive listener to stop the page scrolling underneath.
  useEffect(() => {
    const element = frame.current;
    const onWheel = (event) => {
      // A long airport list scrolls; everywhere else the wheel is zoom.
      if (event.target.closest('.map-picker')) return;
      event.preventDefault();
      const box = element.getBoundingClientRect();
      const factor = event.deltaY < 0 ? 1.25 : 1 / 1.25;
      setView((current) => current && zoomAt(current, factor, event.clientX - box.left, event.clientY - box.top, box.width, box.height));
    };
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
  }, []);

  function zoomBy(factor) {
    setView((current) => zoomAt(current, factor, size.width / 2, size.height / 2, size.width, size.height));
  }

  function activate(cluster) {
    const action = clusterAction(cluster, view, size.width, size.height);
    if (action === 'open') onOpen(cluster.points[0].id);
    else if (action === 'list') setPicking(cluster);
    else setView(fitPoints(cluster.points, size.width, size.height));
  }

  const onPointerDown = (event) => {
    if (event.target.closest('button, .map-picker')) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { x: event.clientX, y: event.clientY };
    setPicking(null);
  };
  const onPointerMove = (event) => {
    if (!drag.current) return;
    const dx = event.clientX - drag.current.x;
    const dy = event.clientY - drag.current.y;
    drag.current = { x: event.clientX, y: event.clientY };
    setView((current) => clampView({ ...current, x: current.x + dx, y: current.y + dy }, size.width, size.height));
  };
  const onPointerUp = () => {
    drag.current = null;
  };

  const zoom = view && size ? view.k / minScale(size.width, size.height) : 1;
  const place = (cluster) => (view ? [cluster.wx * view.k + view.x, cluster.wy * view.k + view.y] : [0, 0]);
  const pickerAt = picking ? pickerPlace(...place(picking), picking.points.length, size.width, size.height) : null;
  const onScreen = ([x, y]) => size && x > -60 && y > -30 && x < size.width + 60 && y < size.height + 30;

  return (
    <div
      className="scenery-map"
      id="scenery-map"
      ref={frame}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      {view && (
        <svg className="map-land" aria-hidden="true" width="100%" height="100%">
          <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
            <path className="map-fill" d={LAND_PATH} />
            <path className="map-border" d={BORDER_PATH} />
          </g>
        </svg>
      )}

      {view &&
        clusters.map((cluster) => {
          const [x, y] = place(cluster);
          if (!onScreen([x, y])) return null;
          const count = cluster.points.length;
          const single = cluster.points[0];
          const label = count > 1 ? `${count} airports` : `${single.ident || 'Airport'}: ${single.title}`;
          return (
            <button
              type="button"
              key={cluster.key}
              className={`map-marker${count > 1 ? ' cluster' : ''}${cluster.conflict ? ' conflict' : ''}`}
              style={{ transform: `translate(${x}px, ${y}px)` }}
              aria-label={label}
              title={count > 1 ? undefined : label}
              onClick={() => activate(cluster)}
            >
              {count > 1 && count}
              {count === 1 && zoom >= LABEL_ZOOM && single.ident && <span className="map-label mono">{single.ident}</span>}
            </button>
          );
        })}

      {picking && (
        <div
          className="map-picker"
          style={{ transform: `translate(${pickerAt[0]}px, ${pickerAt[1]}px)` }}
          role="listbox"
          aria-label="Airports here"
        >
          {picking.points.map((point) => (
            <button type="button" key={point.key} title={point.title} onClick={() => onOpen(point.id)}>
              <span className="mono">{point.ident || '—'}</span>
              <span className="map-picker-title">{point.title}</span>
            </button>
          ))}
        </div>
      )}

      <div className="map-controls">
        <button type="button" aria-label="Zoom in" onClick={() => zoomBy(ZOOM_STEP)}>+</button>
        <button type="button" aria-label="Zoom out" onClick={() => zoomBy(1 / ZOOM_STEP)}>−</button>
        <button type="button" aria-label="Show the whole world" onClick={() => setView(fitWorld(size.width, size.height))}>⌂</button>
      </div>

      <p className="map-credit">Base map: Natural Earth</p>
    </div>
  );
}

export default SceneryMap;
