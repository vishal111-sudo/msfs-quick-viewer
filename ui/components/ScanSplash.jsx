import React from 'react';
import { Progress } from '@/components/ui/progress';

import { installLabel } from '../lib/format.mjs';

const STAGES = [
  { key: 'detect', label: 'Finding your sim' },
  { key: 'read', label: 'Reading your aircraft' },
  { key: 'scenery', label: 'Reading your scenery' },
  { key: 'match', label: 'Matching liveries to aircraft' },
];

/**
 * Scan progress as a checklist: done stages ticked, the current one spinning,
 * later ones waiting. The bar follows add-on packages only, since those are
 * where the time goes; a stock package is a folder name.
 */
export function ScanSplash({ progress }) {
  const current = STAGES.findIndex((stage) => stage.key === progress.stage);
  const useAddons = progress.addonsTotal > 0;
  const done = useAddons ? progress.addonsDone : progress.stockDone;
  const total = useAddons ? progress.addonsTotal : progress.stockTotal;
  const reading = progress.stage === 'scenery';
  let percent = 0;
  if (progress.stage === 'match') percent = 100;
  else if (reading) percent = progress.sceneryTotal ? Math.round((progress.sceneryDone / progress.sceneryTotal) * 100) : 0;
  else if (progress.stage === 'read' && total) percent = Math.round((done / total) * 100);

  return (
    <div className="splash" id="splash">
      <div className="splash-inner" role="status" aria-live="polite">
        <p className="splash-brand">MSFS Quick Viewer</p>
        <p className="splash-install mono" id="splash-install">
          {(progress.installs || []).map(installLabel).join('  ·  ')}
        </p>
        <ol className="stages">
          {STAGES.map((stage, index) => (
            <li
              key={stage.key}
              className="stage"
              data-stage={stage.key}
              data-state={index < current ? 'done' : index === current ? 'active' : 'waiting'}
            >
              <span className="stage-mark" aria-hidden="true" />
              <span className="stage-label">{stage.label}</span>
              {stage.key === 'read' && (
                <span className="stage-count mono" id="stage-count">
                  {progress.stage !== 'detect' && total ? `${done} / ${total} ${useAddons ? 'add-ons' : 'packages'}` : ''}
                </span>
              )}
              {stage.key === 'scenery' && (
                <span className="stage-count mono">
                  {reading && progress.sceneryTotal ? `${progress.sceneryDone} / ${progress.sceneryTotal}` : ''}
                </span>
              )}
            </li>
          ))}
        </ol>
        <Progress className="stage-bar" value={percent} aria-label="Scan progress" />
      </div>
    </div>
  );
}
