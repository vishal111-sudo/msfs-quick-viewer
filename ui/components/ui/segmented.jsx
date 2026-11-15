import * as React from 'react';

import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';

/**
 * A toggle group where exactly one option is on: clicking the selected one
 * again leaves it selected, since "no section" is not a state the app has.
 */
function Segmented({ id, label, value, onChange, options, className }) {
  return (
    <ToggleGroup
      id={id}
      className={`segmented ${className || ''}`}
      aria-label={label}
      variant="outline"
      size="sm"
      spacing={0}
      value={[value]}
      onValueChange={(next) => {
        if (next.length && next[0] !== value) onChange(next[0]);
      }}
    >
      {options.map((option) => (
        <ToggleGroupItem key={option.value} value={option.value} aria-label={option.title || option.label}>
          {option.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

export { Segmented };
