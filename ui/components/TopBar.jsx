import React, { useEffect, useRef, useState } from 'react';
import { Search } from '@arclux/arc-ui-react/Search';
import { Select } from '@arclux/arc-ui-react/Select';
import { SegmentedControl } from '@arclux/arc-ui-react/SegmentedControl';
import { Option } from '@arclux/arc-ui-react/Option';
import { Button } from '@arclux/arc-ui-react/Button';

import { SORTS } from '../lib/filters.mjs';

/**
 * @param {object} props
 * @param {(query: string) => void} props.onSearch debounced, lower-cased
 */
export function TopBar({ searchRef, sort, onSort, size, onSize, onSearch, onRescan, onSettings, disabled }) {
  const [text, setText] = useState('');
  const timer = useRef(null);

  // Debounced: filtering 200+ cards on every keystroke is wasted work.
  useEffect(() => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => onSearch(text.trim().toLowerCase()), 130);
    return () => clearTimeout(timer.current);
  }, [text, onSearch]);

  return (
    <header className="topbar">
      <span className="brand">
        <span className="brand-mark" aria-hidden="true" />
        <span className="brand-name">MSFS Quick Viewer</span>
      </span>

      <Search
        id="search"
        ref={searchRef}
        className="topbar-search"
        placeholder="Search aircraft, developer, livery, ICAO type"
        value={text}
        onArcInput={(event) => setText(event.target.value ?? '')}
        onArcClear={() => setText('')}
      />

      <div className="topbar-actions">
        <Select
          id="sort"
          size="sm"
          className="sort"
          aria-label="Sort by"
          value={sort}
          onArcChange={(event) => onSort(event.target.value)}
        >
          {SORTS.map((option) => (
            <Option key={option.value} value={option.value}>
              {option.label}
            </Option>
          ))}
        </Select>

        <SegmentedControl
          id="card-size"
          aria-label="Card size"
          value={size}
          onArcChange={(event) => onSize(event.target.value)}
        >
          <Option value="small">S</Option>
          <Option value="medium">M</Option>
          <Option value="large">L</Option>
        </SegmentedControl>

        <Button id="rescan" variant="secondary" size="sm" disabled={disabled} onClick={onRescan}>
          Rescan
        </Button>
        <Button id="open-settings" variant="ghost" size="sm" onClick={onSettings}>
          Settings
        </Button>
      </div>
    </header>
  );
}
