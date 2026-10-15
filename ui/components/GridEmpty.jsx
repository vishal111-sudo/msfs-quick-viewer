import React, { useEffect, useState } from 'react';
import { EmptyState } from '@arclux/arc-ui-react/EmptyState';
import { Button } from '@arclux/arc-ui-react/Button';

/**
 * Three different nothings, which need three different answers: the filters
 * exclude everything, the sim was found but holds no aircraft, or no sim was
 * found at all. The last is the first-run failure case, and it has to offer a
 * way forward rather than a shrug.
 */
export function GridEmpty({ scan, onClearFilters, onChooseFolder }) {
  const [candidates, setCandidates] = useState([]);
  const total = scan ? scan.aircraft.length : 0;
  const installs = scan ? scan.installs : [];
  const noSim = scan && total === 0 && installs.length === 0;

  useEffect(() => {
    if (!noSim) return;
    window.api.rootCandidates().then(setCandidates).catch(() => setCandidates([]));
  }, [noSim]);

  if (total > 0) {
    return (
      <div className="empty" id="empty">
        <EmptyState heading="No aircraft match these filters">
          <Button slot="actions" variant="secondary" size="sm" onClick={onClearFilters}>
            Clear filters
          </Button>
        </EmptyState>
      </div>
    );
  }

  if (installs.length) {
    return (
      <div className="empty" id="empty">
        <EmptyState
          heading="No aircraft in that install"
          description={installs.map((install) => install.packagesRoot).join('  ·  ')}
        />
      </div>
    );
  }

  return (
    <div className="empty" id="empty">
      <EmptyState
        heading="No Flight Simulator install found"
        description="Steam and Microsoft Store installs of MSFS 2024 and 2020 are checked automatically. Point the app at your Community folder and it will take it from there."
      >
        <Button slot="actions" variant="primary" onClick={onChooseFolder}>
          Choose your Community folder…
        </Button>
      </EmptyState>
      {candidates.length > 0 && (
        <details className="empty-detail">
          <summary>Where it looked</summary>
          <ul className="empty-paths">
            {candidates.map((candidate) => (
              <li key={candidate.dir} className="mono">
                {candidate.sim} · {candidate.store}: {candidate.dir}
              </li>
            ))}
          </ul>
          <p className="empty-note">
            Each of those holds a UserCfg.opt naming where packages actually live, so a Community folder moved to
            another drive is still found.
          </p>
        </details>
      )}
    </div>
  );
}
