import React, { useEffect, useRef, useState } from 'react';
import { RefreshCwIcon, SearchIcon, SettingsIcon, XIcon } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Kbd } from '@/components/ui/kbd';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Segmented } from '@/components/ui/segmented';

const SECTIONS = [
  { value: 'aircraft', label: 'Aircraft' },
  { value: 'scenery', label: 'Scenery' },
];

const SIZES = [
  { value: 'small', label: 'S', title: 'Small cards' },
  { value: 'medium', label: 'M', title: 'Medium cards' },
  { value: 'large', label: 'L', title: 'Large cards' },
];

/**
 * @param {object} props
 * @param {(query: string) => void} props.onSearch debounced, lower-cased
 * @param {number} props.clearSignal bumps when the app clears the search
 */
export function TopBar({ searchRef, section, onSection, sorts, sort, onSort, size, onSize, onSearch, clearSignal, onRescan, onSettings, onCommand, disabled }) {
  const [text, setText] = useState('');
  const timer = useRef(null);

  // Debounced: filtering 200+ cards on every keystroke is wasted work.
  useEffect(() => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => onSearch(text.trim().toLowerCase()), 130);
    return () => clearTimeout(timer.current);
  }, [text, onSearch]);

  // Each tab starts with its own clean search rather than inheriting a term
  // that means nothing on the other side.
  useEffect(() => setText(''), [section, clearSignal]);

  return (
    <header className="topbar">
      <span className="brand">
        <span className="brand-mark" aria-hidden="true" />
        <span className="brand-name">MSFS Quick Viewer</span>
      </span>

      <Segmented id="section" label="Section" value={section} onChange={onSection} options={SECTIONS} />

      <div className="topbar-search">
        <SearchIcon className="topbar-search-icon" aria-hidden="true" />
        <input
          id="search"
          ref={searchRef}
          type="text"
          spellCheck={false}
          autoComplete="off"
          aria-label="Filter the grid"
          placeholder={section === 'scenery' ? 'Filter scenery, developer, ICAO code' : 'Filter aircraft, developer, livery, ICAO type'}
          value={text}
          onChange={(event) => setText(event.target.value)}
        />
        {text && (
          <button type="button" className="topbar-search-clear" aria-label="Clear search" onClick={() => setText('')}>
            <XIcon aria-hidden="true" />
          </button>
        )}
      </div>

      <div className="topbar-actions">
        <Button id="open-command" variant="outline" size="sm" onClick={onCommand} title="Jump to any aircraft, scenery or action">
          Jump to
          <Kbd>Ctrl K</Kbd>
        </Button>

        <Select key={section} items={sorts} value={sort} onValueChange={onSort}>
          <SelectTrigger id="sort" size="sm" className="sort" aria-label="Sort by">
            <SelectValue />
          </SelectTrigger>
          <SelectContent alignItemWithTrigger={false}>
            {sorts.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Segmented id="card-size" label="Card size" value={size} onChange={onSize} options={SIZES} />

        <Button id="rescan" variant="outline" size="sm" disabled={disabled} onClick={onRescan}>
          <RefreshCwIcon data-icon="inline-start" />
          Rescan
        </Button>
        <Button id="open-settings" variant="ghost" size="icon-sm" aria-label="Settings" title="Settings" onClick={onSettings}>
          <SettingsIcon />
        </Button>
      </div>
    </header>
  );
}
