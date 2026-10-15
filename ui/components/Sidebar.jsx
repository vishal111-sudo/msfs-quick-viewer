import React from 'react';

/**
 * Facet filters. Plain buttons rather than ARC checkboxes: a facet row is a
 * label and a count you click, and 50-odd checkbox components would add
 * weight without adding meaning.
 */
export function Sidebar({ groups, selectedTotal, onToggle, onClearFacet, onClearAll }) {
  return (
    <aside className="sidebar" aria-label="Filters">
      {/* Pinned, so "Clear all" is in reach however far down the list you are. */}
      <div className="facets-head">
        <span className="facets-title">{selectedTotal ? `Filters · ${selectedTotal}` : 'Filters'}</span>
        <button type="button" className="facets-clear" disabled={selectedTotal === 0} onClick={onClearAll}>
          Clear all
        </button>
      </div>

      {groups.map((group) => (
        <section className="facet" key={group.key}>
          <div className="facet-head">
            <h3>{group.label}</h3>
            {group.selectedCount > 0 && (
              <button
                type="button"
                className="facets-clear"
                aria-label={`Clear ${group.label} filters`}
                onClick={() => onClearFacet(group.key)}
              >
                Clear
              </button>
            )}
          </div>
          {group.values.map(({ value, count, selected }) => (
            <button
              type="button"
              key={value}
              className="facet-option"
              aria-pressed={selected}
              onClick={() => onToggle(group.key, value)}
            >
              <span className="label">{value}</span>
              <span className="count">{count}</span>
            </button>
          ))}
        </section>
      ))}
    </aside>
  );
}
