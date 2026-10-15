import React from 'react';
import { Button } from '@arclux/arc-ui-react/Button';

import { useSweep } from '../lib/art.js';
import { sweepEstimate } from '../lib/format.mjs';

/**
 * The first sweep downloads a photo for every stock aircraft while most of
 * the grid shows a placeholder. Unexplained, that reads as broken, so the
 * first sweep says what is happening and offers to stop it on the spot.
 */
export function PhotoNotice({ show, artSource, onTurnOff, onDismiss }) {
  const sweep = useSweep();
  if (!show || !sweep.running || !sweep.total) return null;

  const source = artSource === 'commons' ? 'Wikimedia Commons' : 'Wikipedia';
  const estimate = sweepEstimate(sweep);
  return (
    <div className="notice" id="photo-notice" role="status">
      <p className="notice-text" id="photo-notice-text">
        Finding photos for {sweep.total} aircraft on {source}
        {estimate ? `, ${estimate}.` : '.'} Thumbnails that came with your add-ons are already showing. This only
        happens once.
      </p>
      <Button id="photo-notice-off" variant="secondary" size="sm" onClick={onTurnOff}>
        Turn off photos
      </Button>
      <button type="button" className="notice-close" id="photo-notice-close" aria-label="Dismiss" onClick={onDismiss}>
        ×
      </button>
    </div>
  );
}
