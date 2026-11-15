import React, { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';

/**
 * Three different nothings, which need three different answers: the filters
 * exclude everything, the sim was found but holds no aircraft, or no sim was
 * found at all. The last is the first-run failure case, and it has to offer a
 * way forward rather than a shrug.
 */
function EmptyState({ heading, description, children }) {
  return (
    <div className="empty-state">
      <h2 className="empty-heading">{heading}</h2>
      {description && <p className="empty-text">{description}</p>}
      {children && <div className="empty-actions">{children}</div>}
    </div>
  );
}

export function GridEmpty({ scan, section, onClearFilters, onChooseFolder }) {
  const [candidates, setCandidates] = useState([]);
  const scenery = section === 'scenery';
  const total = scan ? (scenery ? scan.scenery.packages.length : scan.aircraft.length) : 0;
  const installs = scan ? scan.installs : [];
  const noSim = scan && total === 0 && installs.length === 0;

  useEffect(() => {
    if (!noSim) return;
    window.api.rootCandidates().then(setCandidates).catch(() => setCandidates([]));
  }, [noSim]);

  if (total > 0) {
    return (
      <div className="empty" id="empty">
        <EmptyState heading={`No ${scenery ? 'scenery' : 'aircraft'} matches these filters`}>
          <Button variant="outline" size="sm" onClick={onClearFilters}>
            Clear filters
          </Button>
        </EmptyState>
      </div>
    );
  }

  if (scenery && installs.length) {
    return (
      <div className="empty" id="empty">
        <EmptyState
          heading="No add-on scenery found"
          description="Scenery packages in Community will appear here. Stock scenery is not listed yet."
        />
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
        <Button onClick={onChooseFolder}>
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
