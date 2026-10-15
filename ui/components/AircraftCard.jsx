import React, { memo, useEffect, useRef } from 'react';
import { Card } from '@arclux/arc-ui-react/Card';

import { requestArt, useArt, useLookedUp } from '../lib/art.js';
import { placeholderLabel } from '../lib/format.mjs';

/**
 * One observer for every card: a card scrolled within 300px of the viewport
 * asks for its photo. Cheaper than an observer per card, and requestArt()
 * already ignores aircraft that are resolved or in flight.
 */
const pendingCards = new Map();
const observer = new IntersectionObserver(
  (entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      observer.unobserve(entry.target);
      const id = pendingCards.get(entry.target);
      pendingCards.delete(entry.target);
      requestArt(id);
    }
  },
  { rootMargin: '300px' },
);

function AircraftCardImpl({ aircraft, artSource, onOpen }) {
  const art = useArt(aircraft.id);
  const lookedUp = useLookedUp(aircraft.id);
  const ref = useRef(null);
  const src = aircraft.thumbnailUrl || (art && art.url);

  useEffect(() => {
    const element = ref.current;
    if (src || lookedUp || artSource === 'off' || !element) return undefined;
    pendingCards.set(element, aircraft.id);
    observer.observe(element);
    return () => {
      observer.unobserve(element);
      pendingCards.delete(element);
    };
  }, [src, lookedUp, artSource, aircraft.id]);

  const extras = aircraft.developers.length - 1;
  let detail = null;
  if (aircraft.icaoType) detail = <span className="mono">{aircraft.icaoType}</span>;
  else if (aircraft.variant) detail = <span>{aircraft.variant}</span>;
  else if (aircraft.engineLabel && aircraft.engineLabel !== 'Unknown') detail = <span>{aircraft.engineLabel}</span>;

  return (
    <Card
      ref={ref}
      className="card"
      data-id={aircraft.id}
      interactive
      padding="none"
      // ARC's interactive card adds hover styling only. Focus and Enter/Space
      // are ours to provide, as the old cards did.
      role="button"
      tabIndex={0}
      aria-label={aircraft.name}
      onClick={() => onOpen(aircraft.id)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onOpen(aircraft.id);
        }
      }}
    >
      <div className="card-art">
        {src ? (
          <img src={src} alt="" loading="lazy" />
        ) : (
          <div className="placeholder">
            <span className="glyph" aria-hidden="true" />
            <span>{placeholderLabel(aircraft, artSource, lookedUp)}</span>
          </div>
        )}
        {/* Counts read as numerals; words only where a number is ambiguous. */}
        <div className="card-badges">
          {aircraft.variantCount > 1 && <span className="badge">{aircraft.variantCount} var</span>}
          {aircraft.liveryCount > 0 && <span className="badge">{aircraft.liveryCount} liv</span>}
          {!aircraft.enabled && <span className="badge quiet">disabled</span>}
        </div>
      </div>

      <div className="card-body">
        <div className="card-title">{aircraft.name}</div>
        {aircraft.developer && (
          // Extra developers (a livery pack by someone else) are counted, not
          // listed, so the line stays one row tall on every card.
          <div className="card-dev" title={extras > 0 ? aircraft.developers.join(', ') : undefined}>
            {aircraft.developer}
            {extras > 0 && <span className="card-dev-more"> +{extras}</span>}
          </div>
        )}
        <div className="card-meta">
          <span>{aircraft.category}</span>
          {detail}
          {aircraft.version && (
            <span className="card-version mono" title={`Version ${aircraft.version} (${aircraft.versionPackage})`}>
              v{aircraft.version}
            </span>
          )}
        </div>
      </div>
    </Card>
  );
}

export const AircraftCard = memo(AircraftCardImpl);
