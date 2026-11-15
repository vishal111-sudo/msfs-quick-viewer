import React, { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { Toaster } from '@/components/ui/sonner';

import { artStore, startSweep, stopSweep } from '../lib/art.js';
import {
  FACETS,
  SCENERY_FACETS,
  SCENERY_SORTS,
  SORTS,
  clearFacet,
  facetGroups,
  restoreFilters,
  selectedCount,
  serialiseFilters,
  toggleFilter,
  visibleAircraft,
} from '../lib/filters.mjs';
import { plural } from '../lib/format.mjs';
import { applyTheme, followSystemTheme, toast } from '../lib/ui.js';

import { AircraftCard } from './AircraftCard.jsx';
import { CommandMenu } from './CommandMenu.jsx';
import { ContentHead } from './ContentHead.jsx';
import { DetailDrawer } from './DetailDrawer.jsx';
import { GridEmpty } from './GridEmpty.jsx';
import { PhotoNotice } from './PhotoNotice.jsx';
import { ScanSplash } from './ScanSplash.jsx';
import { SceneryCard } from './SceneryCard.jsx';
import { SceneryDrawer } from './SceneryDrawer.jsx';
import { SettingsDrawer } from './SettingsDrawer.jsx';
import { Sidebar } from './Sidebar.jsx';
import { TopBar } from './TopBar.jsx';
import { Welcome } from './Welcome.jsx';

const api = window.api;

// Its own chunk: the world geography is most of a megabyte, and only this
// view needs it.
const SceneryMap = lazy(() => import('./SceneryMap.jsx'));

export function App() {
  const [settings, setSettings] = useState(null);
  const [phase, setPhase] = useState('loading'); // loading | welcome | scanning | ready
  const [progress, setProgress] = useState({ stage: 'detect' });
  const [scan, setScan] = useState(null);

  const [section, setSection] = useState('aircraft');
  const [search, setSearch] = useState('');
  const [sorts, setSorts] = useState({ aircraft: 'aircraft', scenery: 'name' });
  const [size, setSize] = useState('medium');
  // Each section keeps its own filters: "Airliner" means nothing to scenery.
  const [filterSets, setFilterSets] = useState(() => ({ aircraft: new Map(), scenery: new Map() }));

  const [detailId, setDetailId] = useState(null);
  const [sceneryId, setSceneryId] = useState(null);
  const [sceneryView, setSceneryView] = useState('grid');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const [clearSignal, setClearSignal] = useState(0);
  const [explainPhotos, setExplainPhotos] = useState(false);

  const settingsRef = useRef(null);
  settingsRef.current = settings;
  const searchRef = useRef(null);
  const pasteRef = useRef(null);

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
        toast(`Found ${plural(result.stats.aircraft, 'aircraft', 'aircraft')} and ${plural(result.scenery.packages.length, 'scenery package', 'scenery packages')} in ${(result.durationMs / 1000).toFixed(1)}s`);
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
      setFilterSets({
        aircraft: restoreFilters(loaded.lastFilters),
        scenery: restoreFilters(loaded.lastSceneryFilters),
      });
      setSection(loaded.lastSection === 'scenery' ? 'scenery' : 'aircraft');
      setSceneryView(loaded.lastSceneryView === 'map' ? 'map' : 'grid');
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

  const scenerySection = section === 'scenery';
  const filters = filterSets[section];
  const sort = sorts[section];
  const facets = scenerySection ? SCENERY_FACETS : FACETS;

  const updateFilters = useCallback(
    (next) => {
      setFilterSets((sets) => ({ ...sets, [section]: next }));
      const key = section === 'scenery' ? 'lastSceneryFilters' : 'lastFilters';
      api.setSettings({ [key]: serialiseFilters(next) }).catch(() => {});
    },
    [section],
  );

  const view = useMemo(
    () => ({ filters, search, hideDisabled: Boolean(!scenerySection && settings && settings.hideDisabled) }),
    [filters, search, settings, scenerySection],
  );
  const aircraft = scan ? scan.aircraft : [];
  const scenery = scan ? scan.scenery.packages : [];
  const all = scenerySection ? scenery : aircraft;
  const shown = useMemo(() => visibleAircraft(all, view, sort, facets), [all, view, sort, facets]);
  const groups = useMemo(() => facetGroups(all, view, facets), [all, view, facets]);
  const secondCount = useMemo(
    () => shown.reduce((sum, item) => sum + (scenerySection ? item.airports.length : item.liveryCount), 0),
    [shown, scenerySection],
  );
  const detail = detailId ? aircraft.find((a) => a.id === detailId) : null;
  const sceneryDetail = sceneryId ? scenery.find((pkg) => pkg.id === sceneryId) : null;
  const artSource = (settings && settings.artSource) || 'wikipedia';

  function clearEverything() {
    updateFilters(new Map());
    setSearch('');
    setClearSignal((n) => n + 1);
  }

  function changeSection(next) {
    if (next === section) return;
    setSection(next);
    setSearch('');
    api.setSettings({ lastSection: next }).catch(() => {});
  }

  function changeSceneryView(next) {
    setSceneryView(next);
    api.setSettings({ lastSceneryView: next }).catch(() => {});
  }

  function changeSort(next) {
    setSorts((current) => ({ ...current, [section]: next }));
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
  const openScenery = useCallback((id) => setSceneryId(id), []);
  const setPasteTarget = useCallback((fn) => {
    pasteRef.current = fn;
  }, []);

  /* ---------- keyboard and clipboard ---------- */

  useEffect(() => {
    function onKey(event) {
      if (phase !== 'ready') return;
      // Ctrl+K opens the jump menu from anywhere, including a text field.
      if (event.key.toLowerCase() === 'k' && (event.ctrlKey || event.metaKey) && !event.altKey) {
        event.preventDefault();
        setCommandOpen((value) => !value);
        return;
      }
      // "/" jumps to the filter box, unless typing somewhere already or a screen is in front.
      if (event.key !== '/' || settingsOpen || detailId || sceneryId || commandOpen) return;
      const active = event.composedPath()[0];
      if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) return;
      event.preventDefault();
      const input = searchRef.current;
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
  }, [phase, settingsOpen, detailId, sceneryId, commandOpen]);

  /* ---------- render ---------- */

  if (!settings) return <ScanSplash progress={progress} />;

  return (
    <div className="app">
      <TopBar
        searchRef={searchRef}
        section={section}
        onSection={changeSection}
        sorts={scenerySection ? SCENERY_SORTS : SORTS}
        sort={sort}
        onSort={changeSort}
        size={size}
        onSize={changeSize}
        onSearch={setSearch}
        clearSignal={clearSignal}
        onCommand={() => setCommandOpen(true)}
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
            noun={scenerySection ? 'scenery packages' : 'aircraft'}
            secondCount={secondCount}
            secondNoun={scenerySection ? 'airports' : 'liveries'}
            photos={!scenerySection}
            view={scenerySection ? sceneryView : null}
            onView={changeSceneryView}
            unplaced={scenerySection ? shown.filter((pkg) => !pkg.airports.length).length : 0}
            filtered={filters.size > 0 || Boolean(search)}
            onClearFilters={clearEverything}
          />
          <PhotoNotice
            show={explainPhotos && !scenerySection}
            artSource={artSource}
            onTurnOff={turnPhotosOff}
            onDismiss={() => setExplainPhotos(false)}
          />

          {scenerySection && sceneryView === 'map' && phase === 'ready' ? (
            <Suspense fallback={<div className="scenery-map" />}>
              <SceneryMap packages={shown} onOpen={openScenery} />
            </Suspense>
          ) : phase === 'ready' && shown.length === 0 ? (
            <GridEmpty scan={scan} section={section} onClearFilters={clearEverything} onChooseFolder={chooseFolder} />
          ) : (
            <div className="card-grid" id="grid" data-size={size}>
              {scenerySection
                ? shown.map((pkg) => <SceneryCard key={pkg.id} pkg={pkg} onOpen={openScenery} />)
                : shown.map((item) => (
                    <AircraftCard key={item.id} aircraft={item} artSource={artSource} onOpen={openDetail} />
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
      <SceneryDrawer pkg={sceneryDetail} open={Boolean(sceneryDetail)} onClose={() => setSceneryId(null)} onOpen={openScenery} />
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

      <CommandMenu
        open={commandOpen}
        onOpenChange={setCommandOpen}
        aircraft={aircraft}
        scenery={scenery}
        section={section}
        sceneryView={sceneryView}
        theme={settings.theme || 'dark'}
        onAircraft={(id) => {
          changeSection('aircraft');
          setDetailId(id);
        }}
        onScenery={(id) => {
          changeSection('scenery');
          setSceneryId(id);
        }}
        onSection={changeSection}
        onSceneryView={(next) => {
          changeSection('scenery');
          changeSceneryView(next);
        }}
        onTheme={(theme) => saveSettings({ theme })}
        onRescan={rescan}
        onSettings={() => setSettingsOpen(true)}
      />

      <Toaster position="bottom-center" />
    </div>
  );
}
