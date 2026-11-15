import React, { memo } from 'react';

import { airportCodes } from '../lib/format.mjs';

function SceneryCardImpl({ pkg, onOpen }) {
  const codes = airportCodes(pkg);

  return (
    <div
      className="card"
      data-id={pkg.id}
      role="button"
      tabIndex={0}
      aria-label={pkg.title}
      onClick={() => onOpen(pkg.id)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onOpen(pkg.id);
        }
      }}
    >
      <div className="card-art">
        {pkg.thumbnailUrl ? (
          <img src={pkg.thumbnailUrl} alt="" loading="lazy" />
        ) : (
          <div className="placeholder">
            <span className="glyph" aria-hidden="true" />
            <span>No thumbnail</span>
          </div>
        )}
        <div className="card-badges">
          {pkg.conflicts.length > 0 && <span className="badge warn">possible conflict</span>}
          {pkg.status === 'Disabled' && <span className="badge quiet">disabled</span>}
        </div>
      </div>

      <div className="card-body">
        <div className="card-title">{pkg.title}</div>
        {pkg.developer && <div className="card-dev">{pkg.developer}</div>}
        <div className="card-meta">
          <span>{pkg.kindLabel}</span>
          {codes && <span className="mono">{codes}</span>}
          {pkg.version && (
            <span className="card-version mono" title={`Version ${pkg.version}`}>
              v{pkg.version}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

export const SceneryCard = memo(SceneryCardImpl);
