import React, { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { SidePanel } from '@/components/ui/side-panel';

import { installLabel, plural } from '../lib/format.mjs';
import { toast } from '../lib/ui.js';

const api = window.api;

const THEMES = [
  { value: 'dark', label: 'Dark' },
  { value: 'light', label: 'Light' },
  { value: 'system', label: 'Match Windows' },
];

/** A select that shows the chosen option's label and lists the rest. */
function Choice({ id, label, items, value, onChange }) {
  return (
    <Select items={items} value={value} onValueChange={onChange}>
      <SelectTrigger id={id} size="sm" className="setting-select" aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent alignItemWithTrigger={false}>
        {items.map((item) => (
          <SelectItem key={item.value} value={item.value}>
            {item.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function ChipList({ label, items }) {
  if (!items || !items.length) return null;
  return (
    <>
      <p className="setting-note">{label}</p>
      <div className="tags">
        {items.slice(0, 24).map((item) => (
          <Badge key={item} variant="outline">
            {item}
          </Badge>
        ))}
        {items.length > 24 && <Badge variant="outline">+{items.length - 24} more</Badge>}
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
  // Before the list of sources arrives, the current one still needs a label.
  const sourceItems = [
    ...sources.map((source) => ({ value: source.id, label: source.label })),
    { value: 'off', label: 'Off: never use the network' },
  ];
  if (!sourceItems.some((item) => item.value === artSource)) sourceItems.unshift({ value: artSource, label: artSource });
  const diag = scan && scan.diagnostics;
  const orphans = (diag && diag.liveriesWithoutAircraft) || [];
  const sceneryPackages = scan && scan.scenery ? scan.scenery.packages : [];
  const noCode = sceneryPackages.filter((pkg) => pkg.airports.some((airport) => !airport.ident));

  async function addFolder() {
    const result = await api.addRoot();
    if (result.added) await onRescan();
    else if (result.reason === 'not-a-packages-root') toast('That folder has no Community or StreamedPackages inside it');
  }

  return (
    <SidePanel id="settings" open={open} title="Settings" onClose={onClose}>
      <div className="detail settings">
        <p className="detail-sub">Stored locally in your user profile.</p>

        <section className="section">
          <div className="setting">
            <strong>Theme</strong>
            <Choice
              id="setting-theme"
              label="Theme"
              items={THEMES}
              value={settings.theme || 'dark'}
              onChange={(value) => onSettings({ theme: value })}
            />
          </div>

          <div className="setting">
            <strong>Photos for aircraft with no thumbnail</strong>
            <span className="setting-note">
              Stock aircraft are stored encrypted with no picture on disk. An add-on's own artwork is always used first;
              this only fills the gaps, and every photo is cached locally.
            </span>
            <Choice
              id="setting-art-source"
              label="Photo source"
              items={sourceItems}
              value={artSource}
              onChange={onSourceChanged}
            />
            {sourceNote && <span className="setting-note">{sourceNote}</span>}
          </div>

          <div className="setting">
            <label className="setting-check">
              <Checkbox
                id="setting-hide-disabled"
                checked={Boolean(settings.hideDisabled)}
                onCheckedChange={(checked) => onSettings({ hideDisabled: Boolean(checked) })}
              />
              <span>Hide aircraft disabled in the sim</span>
            </label>
            <span className="setting-note">Uses the state recorded in the sim's Content.xml.</span>
          </div>
        </section>

        <section className="section">
          <h3>Packages folders</h3>
          {(scan ? scan.installs : []).map((install) => (
            <div className="root-row" key={install.packagesRoot}>
              <code className="mono">{install.packagesRoot}</code>
              <span className="root-tags">
                {install.store !== 'Manual' && <Badge variant="outline">{installLabel(install)}</Badge>}
                <Badge variant="outline">{install.store === 'Manual' ? 'added' : 'detected'}</Badge>
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
          <Button variant="outline" size="sm" onClick={addFolder}>
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
              <dt>Scenery airports with no code</dt>
              <dd>
                {noCode.length
                  ? `${noCode.reduce((sum, pkg) => sum + pkg.airports.filter((a) => !a.ident).length, 0)}, in ${noCode.length} packages`
                  : 'none'}
              </dd>
              <dt>Liveries with no aircraft</dt>
              <dd>
                {orphans.length ? `${orphans.length}: aircraft not installed, or not recognised` : 'none'}
              </dd>
            </dl>
            <ChipList label="Liveries with no aircraft" items={orphans} />
            <ChipList label="Scenery with airports that have no code" items={noCode.map((pkg) => pkg.title)} />
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
            variant="outline"
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
    </SidePanel>
  );
}
