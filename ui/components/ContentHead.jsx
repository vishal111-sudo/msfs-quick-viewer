import React from 'react';
import NumberFlow from '@number-flow/react';

import { Progress } from '@/components/ui/progress';
import { Segmented } from '@/components/ui/segmented';

import { useSweep } from '../lib/art.js';

const VIEWS = [
  { value: 'grid', label: 'Grid' },
  { value: 'map', label: 'Map' },
];

export function ContentHead({ shown, total, noun, secondCount, secondNoun, photos: showPhotos, filtered, onClearFilters, view, onView, unplaced }) {
  const sweep = useSweep();
  const photos = showPhotos && sweep.running && sweep.total > 0;
  const percent = photos ? Math.round((sweep.done / sweep.total) * 100) : 0;
  const count = shown === total ? `${total}` : `${shown} of ${total}`;

  return (
    <div className="content-head">
      {/* The counts tick over as filters change, rather than jumping. The
          plain text is for tests and screen readers; the animated copy is
          decoration. */}
      <p className="result-count" id="result-count" aria-label={`${count} ${noun}, ${secondCount} ${secondNoun}`} data-shown={shown} data-total={total}>
        <strong>
          <NumberFlow value={shown} aria-hidden="true" />
          {shown !== total && <span className="of-total"> / {total}</span>}
        </strong>{' '}
        {noun}
        <span className="sep" aria-hidden="true">·</span>
        <strong>
          <NumberFlow value={secondCount} aria-hidden="true" />
        </strong>{' '}
        {secondNoun}
      </p>
      {filtered && (
        <button type="button" id="clear-filters" className="text-action" onClick={onClearFilters}>
          Clear filters
        </button>
      )}

      {view === 'map' && unplaced > 0 && (
        <span className="map-unplaced">
          {unplaced} {unplaced === 1 ? 'package has' : 'packages have'} no location
        </span>
      )}

      {view && <Segmented id="scenery-view" className="view-switch" label="View" value={view} onChange={onView} options={VIEWS} />}

      {photos && (
        <div className="art-progress" id="art-progress">
          <span className="art-progress-text" id="art-progress-text">
            Finding photos {sweep.done} / {sweep.total}
          </span>
          <Progress id="art-progress-bar" className="art-progress-bar" value={percent} aria-label="Photos found" />
        </div>
      )}
    </div>
  );
}
