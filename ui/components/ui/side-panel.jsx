import * as React from 'react';
import { Drawer } from 'vaul';
import { XIcon } from 'lucide-react';

import { Button } from '@/components/ui/button';

/**
 * A panel that slides in from the right, on Vaul: it can be flicked shut by
 * dragging its header as well as closed with Escape, the X or a click
 * outside. The body opts out of dragging so its text can be selected: paths
 * and package names here are things people copy.
 */
function SidePanel({ id, open, onClose, title, className, children }) {
  return (
    <Drawer.Root
      direction="right"
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <Drawer.Portal>
        <Drawer.Overlay className="side-overlay" />
        <Drawer.Content id={id} className={`side-panel ${className || ''}`} aria-describedby={undefined}>
          <header className="side-head">
            <Drawer.Title className="side-title">{title}</Drawer.Title>
            <Drawer.Close asChild>
              <Button className="side-close" variant="ghost" size="icon-sm" aria-label="Close">
                <XIcon />
              </Button>
            </Drawer.Close>
          </header>
          <div className="side-body" data-vaul-no-drag>
            {children}
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}

/** Keep showing the last item while its panel slides shut. */
function useLast(value) {
  const last = React.useRef(value);
  if (value) last.current = value;
  return value || last.current;
}

export { SidePanel, useLast };
