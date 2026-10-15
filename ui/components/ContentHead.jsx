import React from 'react';
import { Progress } from '@arclux/arc-ui-react/Progress';

import { useSweep } from '../lib/art.js';

export function ContentHead({ shown, total, liveries, filtered, onClearFilters }) {
  const sweep = useSweep();
  const photos = sweep.running && sweep.total > 0;
  const percent = photos ? Math.round((sweep.done / sweep.total) * 100) : 0;

  return (
    <div className="content-head">
      <p className="result-count" id="result-count">
        <strong>{shown === total ? total : `${shown} / ${total}`}</strong> aircraft
        <span className="sep" aria-hidden="true">·</span>
        <strong>{liveries}</strong> liveries
      </p>
      {filtered && (
        <button type="button" id="clear-filters" className="text-action" onClick={onClearFilters}>
          Clear filters
        </button>
      )}

      {photos && (
        <div className="art-progress" id="art-progress">
          <span className="art-progress-text" id="art-progress-text">
            Finding photos {sweep.done} / {sweep.total}
          </span>
          <Progress id="art-progress-bar" className="art-progress-bar" size="sm" value={percent} />
        </div>
      )}
    </div>
  );
}
