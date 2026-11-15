import React from 'react';
import { LayoutGridIcon, MapIcon, MoonIcon, PlaneIcon, RefreshCwIcon, SettingsIcon, SunIcon, TowerControlIcon } from 'lucide-react';

import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';

import { airportCodes } from '../lib/format.mjs';
import { matchScore } from '../lib/filters.mjs';

/**
 * Ctrl+K: jump straight to any aircraft, scenery package or action. The top
 * bar's box filters the grid you are looking at; this goes to one thing,
 * wherever it is. Built on cmdk, so arrow keys, Enter and Escape all work.
 */
export function CommandMenu({
  open,
  onOpenChange,
  aircraft,
  scenery,
  section,
  sceneryView,
  theme,
  onAircraft,
  onScenery,
  onSection,
  onSceneryView,
  onTheme,
  onRescan,
  onSettings,
}) {
  const run = (action) => () => {
    onOpenChange(false);
    action();
  };

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Jump to"
      description="Search aircraft, scenery and actions"
      className="command-menu sm:max-w-xl"
    >
      <Command id="command-menu" filter={matchScore}>
        <CommandInput placeholder="Jump to an aircraft, airport or action" />
        <CommandList>
          <CommandEmpty>Nothing matches.</CommandEmpty>

          <CommandGroup heading="Actions">
            {section !== 'aircraft' && (
              <CommandItem value="action show aircraft" onSelect={run(() => onSection('aircraft'))}>
                <PlaneIcon />
                Show aircraft
              </CommandItem>
            )}
            {section !== 'scenery' && (
              <CommandItem value="action show scenery" onSelect={run(() => onSection('scenery'))}>
                <TowerControlIcon />
                Show scenery
              </CommandItem>
            )}
            {!(section === 'scenery' && sceneryView === 'map') && (
              <CommandItem value="action scenery map world" onSelect={run(() => onSceneryView('map'))}>
                <MapIcon />
                Scenery on the map
              </CommandItem>
            )}
            {section === 'scenery' && sceneryView === 'map' && (
              <CommandItem value="action scenery grid" onSelect={run(() => onSceneryView('grid'))}>
                <LayoutGridIcon />
                Scenery as a grid
              </CommandItem>
            )}
            <CommandItem value="action rescan refresh" onSelect={run(onRescan)}>
              <RefreshCwIcon />
              Rescan
            </CommandItem>
            {theme !== 'light' && (
              <CommandItem value="action light theme" onSelect={run(() => onTheme('light'))}>
                <SunIcon />
                Light theme
              </CommandItem>
            )}
            {theme !== 'dark' && (
              <CommandItem value="action dark theme" onSelect={run(() => onTheme('dark'))}>
                <MoonIcon />
                Dark theme
              </CommandItem>
            )}
            <CommandItem value="action settings preferences" onSelect={run(onSettings)}>
              <SettingsIcon />
              Settings
            </CommandItem>
          </CommandGroup>

          <CommandGroup heading={`Aircraft (${aircraft.length})`}>
            {aircraft.map((item) => (
              <CommandItem
                key={item.id}
                value={`aircraft ${item.id}`}
                keywords={[item.name, item.developer, item.icaoType].filter(Boolean)}
                onSelect={run(() => onAircraft(item.id))}
              >
                <span className="command-name">{item.name}</span>
                <span className="command-meta">{[item.icaoType, item.developer].filter(Boolean).join(' · ')}</span>
              </CommandItem>
            ))}
          </CommandGroup>

          <CommandGroup heading={`Scenery (${scenery.length})`}>
            {scenery.map((pkg) => {
              const codes = airportCodes(pkg);
              return (
                <CommandItem
                  key={pkg.id}
                  value={`scenery ${pkg.id}`}
                  keywords={[pkg.title, pkg.developer, ...pkg.airports.map((airport) => airport.ident)].filter(Boolean)}
                  onSelect={run(() => onScenery(pkg.id))}
                >
                  <span className="command-name">{pkg.title}</span>
                  <span className="command-meta">{[codes, pkg.developer].filter(Boolean).join(' · ')}</span>
                </CommandItem>
              );
            })}
          </CommandGroup>
        </CommandList>
      </Command>
    </CommandDialog>
  );
}
