import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Toast } from '@arclux/arc-ui-react/Toast';

import { artStore, startSweep, stopSweep } from '../lib/art.js';
import {
  clearFacet,
  facetGroups,
  restoreFilters,
  selectedCount,
  serialiseFilters,
  toggleFilter,
  visibleAircraft,
} from '../lib/filters.mjs';
import { plural } from '../lib/format.mjs';
import { applyTheme, bindToast, followSystemTheme, innerInput, toast } from '../lib/ui.js';

import { AircraftCard } from './AircraftCard.jsx';
import { ContentHead } from './ContentHead.jsx';
import { DetailDrawer } from './DetailDrawer.jsx';
import { GridEmpty } from './GridEmpty.jsx';
import { PhotoNotice } from './PhotoNotice.jsx';
import { ScanSplash } from './ScanSplash.jsx';
import { SettingsDrawer } from './SettingsDrawer.jsx';
import { Sidebar } from './Sidebar.jsx';
import { TopBar } from './TopBar.jsx';
import { Welcome } from './Welcome.jsx';

const api = window.api;

export function App() {
  const [settings, setSettings] = useState(null);
  const [phase, setPhase] = useState('loading'); // loading | welcome | scanning | ready
  const [progress, setProgress] = useState({ stage: 'detect' });
  const [scan, setScan] = useState(null);

  const [search, setSearch] = useState('');
  const [sort, setSort] = useState('aircraft');
  const [size, setSize] = useState('medium');
  const [filters, setFilters] = useState(() => new Map());

  const [detailId, setDetailId] = useState(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [explainPhotos, setExplainPhotos] = useState(false);

  const settingsRef = useRef(null);
  settingsRef.current = settings;
  const searchRef = useRef(null);
  const pasteRef = useRef(null);
  const toastRef = useCallback((element) => bindToast(element), []);

  /* ---------- settings ---------- */

  const saveSettings = useCallback(async (patch) => {
    if (patch.theme) applyTheme(patch.theme);
    const next = await api.setSettings(patch);
    setSettings(next);
    return next;
  }, []);

  useEffect(() => followSystemTheme(() => settingsRef.current && settingsRef.current.theme), []);

  /* ---------- scanning ---------- */

  useEffect(() => api.onScanProgress(setProgress), []);

  const runSweep = useCallback(async (aircraft, artSource) => {
    const found = await startSweep(aircraft, artSource);
    if (found === null) return; // abandoned for a newer sweep
    setExplainPhotos(false);
    if (found) toast(`Found ${plural(found, 'photo', 'photos')}`);
  }, []);

  const rescan = useCallback(async () => {
    setPhase('scanning');
    setProgress({ stage: 'detect' });
    stopSweep();
    try {
      const result = await api.scan();
      // The main process already resolved everything in the artwork cache,
      // so a relaunch paints at once instead of asking card by card.
      artStore.reset(result.aircraft);
      setScan(result);
      setPhase('ready');
      if (result.stats.aircraft > 0) {
        toast(`Found ${plural(result.stats.aircraft, 'aircraft', 'aircraft')} in ${(result.durationMs / 1000).toFixed(1)}s`);
      }
      runSweep(result.aircraft, (settingsRef.current || {}).artSource);
    } catch (err) {
      setPhase('ready');
      toast(`Scan failed: ${err.message}`, 'error');
    }
  }, [runSweep]);

  useEffect(() => {
    (async () => {
      const loaded = await api.getSettings();
      applyTheme(loaded.theme);
      setSettings(loaded);
      setSize(loaded.cardSize || 'medium');
      setFilters(restoreFilters(loaded.lastFilters));
      if (!loaded.welcomed) setPhase('welcome');
      else rescan();
    })();
  }, [rescan]);

  async function finishWelcome(artSource) {
    await saveSettings({ artSource, welcomed: true });
    setExplainPhotos(artSource !== 'off');
    await rescan();
  }

  /* ---------- view ---------- */

  const updateFilters = useCallback((next) => {
    setFilters(next);
    api.setSettings({ lastFilters: serialiseFilters(next) }).catch(() => {});
  }, []);

  const view = useMemo(
    () => ({ filters, search, hideDisabled: Boolean(settings && settings.hideDisabled) }),
    [filters, search, settings],
  );
  const all = scan ? scan.aircraft : [];
  const shown = useMemo(() => visibleAircraft(all, view, sort), [all, view, sort]);
  const groups = useMemo(() => facetGroups(all, view), [all, view]);
  const liveries = useMemo(() => shown.reduce((sum, a) => sum + a.liveryCount, 0), [shown]);
  const detail = detailId ? all.find((a) => a.id === detailId) : null;
  const artSource = (settings && settings.artSource) || 'wikipedia';

  function clearEverything() {
    updateFilters(new Map());
    setSearch('');
    const input = innerInput(searchRef.current);
    if (searchRef.current) searchRef.current.value = '';
    if (input) input.value = '';
  }

  function changeSize(next) {
    setSize(next);
    api.setSettings({ cardSize: next }).catch(() => {});
  }

  async function changeSource(next) {
    await saveSettings({ artSource: next });
    // Each source caches separately, so switching back is instant.
    artStore.reset(all);
    runSweep(all, next);
    toast(next === 'off' ? 'Online photos off' : 'Photo source changed');
  }

  async function turnPhotosOff() {
    await saveSettings({ artSource: 'off' });
    stopSweep();
    setExplainPhotos(false);
    toast('Photos are off. Turn them back on in Settings.');
  }

  async function chooseFolder() {
    const result = await api.addRoot();
    if (result.added) await rescan();
    else if (result.reason === 'not-a-packages-root') toast('That folder has no Community or StreamedPackages inside it');
  }

  const openDetail = useCallback((id) => setDetailId(id), []);
  const setPasteTarget = useCallback((fn) => {
    pasteRef.current = fn;
  }, []);

  /* ---------- keyboard and clipboard ---------- */

  useEffect(() => {
    function onKey(event) {
      // "/" jumps to search, unless typing somewhere already or a screen is in front.
      if (event.key !== '/' || phase !== 'ready' || settingsOpen || detailId) return;
      const active = event.composedPath()[0];
      if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) return;
      event.preventDefault();
      const input = innerInput(searchRef.current);
      if (input) {
        input.focus();
        input.select();
      }
    }
    function onPaste() {
      // The clipboard is read in the main process; this only triggers it.
      if (pasteRef.current) pasteRef.current();
    }
    document.addEventListener('keydown', onKey);
    document.addEventListener('paste', onPaste);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('paste', onPaste);
    };
  }, [phase, settingsOpen, detailId]);

  /* ---------- render ---------- */

  if (!settings) return <ScanSplash progress={progress} />;

  return (
    <div className="app">
      <TopBar
        searchRef={searchRef}
        sort={sort}
        onSort={setSort}
        size={size}
        onSize={changeSize}
        onSearch={setSearch}
        onRescan={rescan}
        onSettings={() => setSettingsOpen(true)}
        disabled={phase === 'scanning'}
      />

      <div className="layout">
        <Sidebar
          groups={groups}
          selectedTotal={selectedCount(filters)}
          onToggle={(key, value) => updateFilters(toggleFilter(filters, key, value))}
          onClearFacet={(key) => updateFilters(clearFacet(filters, key))}
          onClearAll={() => updateFilters(new Map())}
        />

        <main className="content">
          <ContentHead
            shown={shown.length}
            total={all.length}
            liveries={liveries}
            filtered={filters.size > 0 || Boolean(search)}
            onClearFilters={clearEverything}
          />
          <PhotoNotice
            show={explainPhotos}
            artSource={artSource}
            onTurnOff={turnPhotosOff}
            onDismiss={() => setExplainPhotos(false)}
          />

          {phase === 'ready' && shown.length === 0 ? (
            <GridEmpty scan={scan} onClearFilters={clearEverything} onChooseFolder={chooseFolder} />
          ) : (
            <div className="grid" id="grid" data-size={size}>
              {shown.map((aircraft) => (
                <AircraftCard key={aircraft.id} aircraft={aircraft} artSource={artSource} onOpen={openDetail} />
              ))}
            </div>
          )}
        </main>
      </div>

      <DetailDrawer
        aircraft={detail}
        open={Boolean(detail)}
        onClose={() => setDetailId(null)}
        onPasteTarget={setPasteTarget}
      />
      <SettingsDrawer
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        settings={settings}
        scan={scan}
        onSettings={saveSettings}
        onSourceChanged={changeSource}
        onRescan={rescan}
        onCacheCleared={() => artStore.reset([])}
      />

      {phase === 'welcome' && <Welcome initialSource={settings.artSource} onStart={finishWelcome} />}
      {(phase === 'scanning' || phase === 'loading') && <ScanSplash progress={progress} />}

      <Toast id="toast" ref={toastRef} position="bottom-center" />
    </div>
  );
}
