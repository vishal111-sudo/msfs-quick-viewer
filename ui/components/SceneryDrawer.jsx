import React from 'react';
import { Badge } from '@/components/ui/badge';
import { SidePanel, useLast } from '@/components/ui/side-panel';

import { formatCoordinates, orDash, statusNote } from '../lib/format.mjs';
import { toast } from '../lib/ui.js';

const api = window.api;

function Overlap({ title, note, items, onOpen }) {
  if (!items.length) return null;
  return (
    <section className="section">
      <h3>{title}</h3>
      <p className="setting-note">{note}</p>
      {items.map((item, index) => (
        <div className="overlap" key={`${item.ident || 'place'}-${index}`}>
          <span className="mono">{item.ident || formatCoordinates(item)}</span>
          <span>
            {item.with.map((other, position) => (
              <React.Fragment key={other.id}>
                {position > 0 && ', '}
                <button type="button" className="text-action" onClick={() => onOpen(other.id)}>
                  {other.title}
                </button>
              </React.Fragment>
            ))}
          </span>
        </div>
      ))}
    </section>
  );
}

export function SceneryDrawer({ pkg: current, open, onClose, onOpen }) {
  const pkg = useLast(current);
  if (!pkg) return null;

  const inferred = pkg.airports.some((airport) => airport.identSource === 'inferred');
  const note = statusNote(pkg.status);

  return (
    <SidePanel id="scenery-detail" open={open} title={pkg.title} onClose={onClose}>
      <div className="detail">
        {pkg.thumbnailUrl && (
          <div className="detail-hero">
            <img src={pkg.thumbnailUrl} alt="" />
          </div>
        )}

        {pkg.developer && <p className="detail-sub">{pkg.developer}</p>}
        <div className="tags">
          <Badge variant="outline">{pkg.kindLabel}</Badge>
          <Badge variant="outline">{pkg.status}</Badge>
          <Badge variant="outline">{pkg.sourceLabel || pkg.source}</Badge>
        </div>

        <section className="section">
          <h3>Details</h3>
          <dl className="kv">
            <dt>Developer</dt>
            <dd>{orDash(pkg.developer)}</dd>
            <dt>Version</dt>
            <dd>{orDash(pkg.version)}</dd>
            <dt>Status</dt>
            <dd>{pkg.status}</dd>
          </dl>
          {note && <p className="setting-note">{note}</p>}
        </section>

        <Overlap
          title="Possible conflicts"
          note="Another developer's add-on also defines this airport, and both are loaded. That can be a real clash, or one can be a patch for the other, so check before removing anything."
          items={pkg.conflicts}
          onOpen={onOpen}
        />
        <Overlap
          title="Same developer"
          note="Another package from this developer covers the same airport. This is often a deliberate pair."
          items={pkg.companions}
          onOpen={onOpen}
        />

        {pkg.stockAirports.length > 0 && (
          <section className="section">
            <h3>Over stock airports</h3>
            <p className="setting-note">The sim has its own package for these. This add-on is meant to sit over it, so nothing is wrong.</p>
            <div className="tags">
              {pkg.stockAirports.map((ident) => (
                <Badge key={ident} variant="outline" className="mono">
                  {ident}
                </Badge>
              ))}
            </div>
          </section>
        )}

        {pkg.airports.length > 0 && (
          <section className="section">
            <h3>Airports ({pkg.airports.length})</h3>
            <dl className="kv">
              {pkg.airports.map((airport, index) => (
                <React.Fragment key={`${airport.ident || 'unknown'}-${index}`}>
                  <dt className="mono">
                    {airport.ident || 'No code'}
                    {airport.identSource === 'inferred' ? ' *' : ''}
                  </dt>
                  <dd className="mono">{formatCoordinates(airport)}</dd>
                </React.Fragment>
              ))}
            </dl>
            {inferred && <p className="setting-note">* Taken from the package's names, because the scenery file does not store a code.</p>}
          </section>
        )}

        {pkg.kind === 'navdata' && (
          <section className="section">
            <h3>Airports</h3>
            <p className="setting-note">Navigation data covers airports worldwide, so it is not treated as scenery at any one place.</p>
          </section>
        )}

        <section className="section">
          <h3>Package</h3>
          <div className="package">
            <div className="package-head">
              <strong className="mono">{pkg.folderName}</strong>
            </div>
            <div className="package-path mono">{pkg.dir}</div>
            <button
              type="button"
              className="text-action"
              onClick={async () => {
                if (!(await api.openPath(pkg.dir))) toast('Could not open that folder');
              }}
            >
              Open folder
            </button>
          </div>
        </section>
      </div>
    </SidePanel>
  );
}
