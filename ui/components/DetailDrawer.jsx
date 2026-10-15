import React, { useCallback, useEffect, useState } from 'react';
import { Drawer } from '@arclux/arc-ui-react/Drawer';
import { Button } from '@arclux/arc-ui-react/Button';
import { Tag } from '@arclux/arc-ui-react/Tag';

import { artStore, requestArt, useArt } from '../lib/art.js';
import { orDash, versionLabel } from '../lib/format.mjs';
import { toast } from '../lib/ui.js';

const api = window.api;

function Row({ term, value }) {
  return (
    <>
      <dt>{term}</dt>
      <dd>{orDash(value)}</dd>
    </>
  );
}

/** The detail drawer. `onPasteTarget` hands App the paste action while open. */
export function DetailDrawer({ aircraft, open, onClose, onPasteTarget }) {
  const art = useArt(aircraft ? aircraft.id : '');
  const [searching, setSearching] = useState(false);
  const id = aircraft && aircraft.id;

  // The card may never have scrolled into view, so make sure a stock
  // aircraft's photo is fetched for the hero.
  useEffect(() => {
    if (open && aircraft && !aircraft.thumbnailUrl) requestArt(aircraft.id);
  }, [open, aircraft]);

  const paste = useCallback(async () => {
    if (!id) return;
    const pasted = await api.pasteArtOverride(id).catch(() => null);
    if (!pasted) {
      toast('No image on the clipboard');
      return;
    }
    artStore.set(id, pasted);
    toast('Thumbnail set from clipboard');
  }, [id]);

  // Ctrl+V anywhere while this drawer is open pastes onto this aircraft.
  useEffect(() => {
    onPasteTarget(open && id ? paste : null);
    return () => onPasteTarget(null);
  }, [open, id, paste, onPasteTarget]);

  if (!aircraft) return <Drawer id="detail" className="detail-drawer" position="right" open={false} />;

  const heroSrc = aircraft.thumbnailUrl || (art && art.url);
  const chips = [
    aircraft.category,
    aircraft.variant,
    aircraft.engineLabel !== 'Unknown' ? aircraft.engineLabel : null,
    aircraft.size !== 'Unknown' ? aircraft.size : null,
    aircraft.icaoType,
    aircraft.source,
    aircraft.enabled ? null : 'Disabled in sim',
  ].filter(Boolean);

  async function setThumbnail() {
    const result = await api.setArtOverride(aircraft.id);
    if (!result) return;
    artStore.set(aircraft.id, result);
    toast('Thumbnail updated');
  }

  async function findDifferent() {
    setSearching(true);
    const found = await requestArt(aircraft.id, { force: true });
    setSearching(false);
    toast(found ? `Photo from ${found.pageTitle || 'Wikipedia'}` : 'No other photo found');
  }

  async function removeCustom() {
    await api.clearArtOverride(aircraft.id);
    artStore.delete(aircraft.id);
    toast('Custom thumbnail removed');
  }

  return (
    <Drawer id="detail" className="detail-drawer" position="right" open={open} heading={aircraft.name} onArcClose={onClose}>
      <div className="detail">
        <div className="detail-hero">{heroSrc && <img src={heroSrc} alt="" />}</div>

        {art && art.origin === 'online' && (
          // CC BY-SA requires the photographer to be named wherever the photo shows.
          <p className="art-credit">
            Photo: {[art.attribution, art.license].filter(Boolean).join(' · ')}
            {art.attribution || art.license ? ' · ' : ''}
            <button type="button" className="text-action" onClick={() => api.openExternal(art.pageUrl || art.filePageUrl)}>
              {art.pageTitle || 'source'}
            </button>
          </p>
        )}

        <p className="detail-sub">{[aircraft.developer, aircraft.sim].filter(Boolean).join(' · ')}</p>
        <div className="tags">
          {chips.map((value) => (
            <Tag key={value} size="sm" className={value === aircraft.icaoType ? 'mono' : undefined}>
              {value}
            </Tag>
          ))}
        </div>

        <div className="detail-actions">
          <Button variant="secondary" size="sm" onClick={setThumbnail}>
            Set thumbnail…
          </Button>
          <Button variant="secondary" size="sm" title="Copy any picture, then paste it here (Ctrl+V)" onClick={paste}>
            Paste image
          </Button>
          {!aircraft.thumbnailUrl && (
            <Button variant="ghost" size="sm" loading={searching} disabled={searching} onClick={findDifferent}>
              {searching ? 'Searching…' : 'Find a different photo'}
            </Button>
          )}
          {art && art.origin === 'override' && (
            <Button variant="ghost" size="sm" onClick={removeCustom}>
              Remove custom thumbnail
            </Button>
          )}
        </div>

        <section className="section">
          <h3>Details</h3>
          <dl className="kv">
            <Row term="Manufacturer" value={aircraft.manufacturer} />
            <Row term="Model" value={aircraft.model} />
            <Row term="Variant" value={aircraft.variant} />
            <Row term="ICAO type" value={aircraft.icaoType} />
            <Row term="Type role" value={aircraft.typeRole} />
            <Row
              term="Engines"
              value={aircraft.engineCount ? `${aircraft.engineCount} × ${aircraft.engineType}` : aircraft.engineType}
            />
            <Row term="Wake category" value={aircraft.size} />
            <Row term="Developers" value={aircraft.developers.join(', ')} />
            <Row term="Version" value={versionLabel(aircraft)} />
          </dl>
        </section>

        <section className="section">
          <h3>Packages ({aircraft.packages.length})</h3>
          {aircraft.packages.map((pkg) => (
            <div className="package" key={pkg.folderName}>
              <div className="package-head">
                <strong className="mono">{pkg.folderName}</strong>
                <Tag size="sm">{pkg.sourceLabel || pkg.source}</Tag>
                {pkg.version && (
                  <Tag size="sm" className="mono">
                    v{pkg.version}
                  </Tag>
                )}
                {pkg.enabled === 'disabled' && <Tag size="sm">disabled</Tag>}
              </div>
              {pkg.sealed ? (
                <div className="package-path">Streamed package: its contents are encrypted by the sim</div>
              ) : (
                <>
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
                </>
              )}
            </div>
          ))}
        </section>

        {aircraft.variantNames && aircraft.variantNames.length > 1 && (
          <section className="section">
            <h3>Variants ({aircraft.variantNames.length})</h3>
            <div className="tags">
              {aircraft.variantNames.map((name) => (
                <Tag key={name} size="sm">
                  {name}
                </Tag>
              ))}
            </div>
          </section>
        )}

        {aircraft.liveries.length > 0 && (
          <section className="section">
            <h3>Liveries ({aircraft.liveries.length})</h3>
            <div className="livery-grid">
              {aircraft.liveries.map((livery) => (
                <figure className="livery" key={livery.id}>
                  <div className="livery-art">
                    {livery.thumbnailUrl ? (
                      <img src={livery.thumbnailUrl} alt="" loading="lazy" />
                    ) : (
                      <span className="placeholder">{livery.sealed ? 'encrypted' : 'no art'}</span>
                    )}
                  </div>
                  <figcaption className="livery-name">{livery.name}</figcaption>
                </figure>
              ))}
            </div>
          </section>
        )}
      </div>
    </Drawer>
  );
}
