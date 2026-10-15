import React, { useEffect, useState } from 'react';
import { Drawer } from '@arclux/arc-ui-react/Drawer';
import { Select } from '@arclux/arc-ui-react/Select';
import { Option } from '@arclux/arc-ui-react/Option';
import { Checkbox } from '@arclux/arc-ui-react/Checkbox';
import { Button } from '@arclux/arc-ui-react/Button';
import { Tag } from '@arclux/arc-ui-react/Tag';

import { installLabel, plural } from '../lib/format.mjs';
import { toast } from '../lib/ui.js';

const api = window.api;

const THEMES = [
  ['dark', 'Dark'],
  ['light', 'Light'],
  ['system', 'Match Windows'],
];

function ChipList({ label, items }) {
  if (!items || !items.length) return null;
  return (
    <>
      <p className="setting-note">{label}</p>
      <div className="tags">
        {items.slice(0, 24).map((item) => (
          <Tag key={item} size="sm">
            {item}
          </Tag>
        ))}
        {items.length > 24 && <Tag size="sm">+{items.length - 24} more</Tag>}
      </div>
    </>
  );
}

export function SettingsDrawer({ open, onClose, settings, scan, onSettings, onSourceChanged, onRescan, onCacheCleared }) {
  const [sources, setSources] = useState([]);
  const [cache, setCache] = useState(null);

  // Refreshed every time the drawer opens, since the cache grows as you browse.
  useEffect(() => {
    if (!open) return;
    api.artSources().then((result) => setSources(result.sources)).catch(() => setSources([]));
    api.artCacheInfo().then(setCache).catch(() => setCache(null));
  }, [open]);

  const artSource = settings.artSource || 'wikipedia';
  const sourceNote =
    artSource === 'off'
      ? 'The app makes no network requests at all.'
      : (sources.find((source) => source.id === artSource) || {}).note;
  const diag = scan && scan.diagnostics;
  const orphans = (diag && diag.liveriesWithoutAircraft) || [];

  async function addFolder() {
    const result = await api.addRoot();
    if (result.added) await onRescan();
    else if (result.reason === 'not-a-packages-root') toast('That folder has no Community or StreamedPackages inside it');
  }

  return (
    <Drawer id="settings" className="settings-drawer" position="right" open={open} heading="Settings" onArcClose={onClose}>
      <div className="detail settings">
        <p className="detail-sub">Stored locally in your user profile.</p>

        <section className="section">
          <div className="setting">
            <strong>Theme</strong>
            <Select
              size="sm"
              value={settings.theme || 'dark'}
              onArcChange={(event) => onSettings({ theme: event.target.value })}
            >
              {THEMES.map(([value, label]) => (
                <Option key={value} value={value}>
                  {label}
                </Option>
              ))}
            </Select>
          </div>

          <div className="setting">
            <strong>Photos for aircraft with no thumbnail</strong>
            <span className="setting-note">
              Stock aircraft are stored encrypted with no picture on disk. An add-on's own artwork is always used first;
              this only fills the gaps, and every photo is cached locally.
            </span>
            <Select size="sm" value={artSource} onArcChange={(event) => onSourceChanged(event.target.value)}>
              {sources.map((source) => (
                <Option key={source.id} value={source.id}>
                  {source.label}
                </Option>
              ))}
              <Option value="off">Off: never use the network</Option>
            </Select>
            {sourceNote && <span className="setting-note">{sourceNote}</span>}
          </div>

          <div className="setting">
            <Checkbox
              label="Hide aircraft disabled in the sim"
              checked={Boolean(settings.hideDisabled)}
              onArcChange={(event) => onSettings({ hideDisabled: event.target.checked })}
            />
            <span className="setting-note">Uses the state recorded in the sim's Content.xml.</span>
          </div>
        </section>

        <section className="section">
          <h3>Packages folders</h3>
          {(scan ? scan.installs : []).map((install) => (
            <div className="root-row" key={install.packagesRoot}>
              <code className="mono">{install.packagesRoot}</code>
              <span className="root-tags">
                {install.store !== 'Manual' && <Tag size="sm">{installLabel(install)}</Tag>}
                <Tag size="sm">{install.store === 'Manual' ? 'added' : 'detected'}</Tag>
                {install.store === 'Manual' && (
                  <button
                    type="button"
                    className="text-action"
                    onClick={async () => {
                      await api.removeRoot(install.packagesRoot);
                      await onRescan();
                    }}
                  >
                    Remove
                  </button>
                )}
              </span>
            </div>
          ))}
          <Button variant="secondary" size="sm" onClick={addFolder}>
            Add a packages folder…
          </Button>
        </section>

        {diag && (
          // Where the app had to guess for this install, so a library it was
          // never tested against reports its own gaps.
          <section className="section">
            <h3>Scan diagnostics</h3>
            <dl className="kv">
              <dt>Developer tags learned</dt>
              <dd>{diag.vendorTokensLearned}</dd>
              <dt>Stock aircraft not in catalog</dt>
              <dd>
                {diag.unknownStockAircraft.length
                  ? `${diag.unknownStockAircraft.length}, named from their folder`
                  : 'none'}
              </dd>
              <dt>Uncategorised</dt>
              <dd>
                {diag.uncategorised.length ? `${diag.uncategorised.length} listed under "Other"` : 'none'}
              </dd>
              <dt>Liveries with no aircraft</dt>
              <dd>
                {orphans.length ? `${orphans.length}: aircraft not installed, or not recognised` : 'none'}
              </dd>
            </dl>
            <ChipList label="Liveries with no aircraft" items={orphans} />
            <ChipList label="Developer tags" items={diag.vendorTokens} />
            <ChipList label="Not in catalog" items={diag.unknownStockAircraft} />
            <ChipList label="Uncategorised" items={diag.uncategorised} />
          </section>
        )}

        <section className="section">
          <h3>Artwork cache</h3>
          {cache && (
            <p className="setting-note mono">
              {plural(cache.files, 'image', 'images')} · {(cache.bytes / 1024 / 1024).toFixed(1)} MB
            </p>
          )}
          <Button
            variant="secondary"
            size="sm"
            onClick={async () => {
              await api.clearArtCache();
              setCache({ files: 0, bytes: 0 });
              onCacheCleared();
              toast('Artwork cache cleared');
            }}
          >
            Clear cached artwork
          </Button>
        </section>

        <section className="section">
          <h3>About</h3>
          <p className="setting-note">
            MSFS Quick Viewer is an unofficial, independent tool. It is not affiliated with, endorsed by, or connected to
            Microsoft or Asobo Studio. Microsoft Flight Simulator is a trademark of Microsoft Corporation.
          </p>
        </section>
      </div>
    </Drawer>
  );
}
