import React, { useEffect, useRef, useState } from 'react';
import { Button } from '@arclux/arc-ui-react/Button';

import { installLabel } from '../lib/format.mjs';
import { toast } from '../lib/ui.js';

const api = window.api;

/**
 * Shown once, before the first scan. It answers the three things a new user
 * cannot otherwise know: what this is, which sim install it is about to read,
 * and that it will go online for photos unless told not to.
 *
 * The photo choice is a plain radio list rather than ARC's radio group: each
 * option needs a second line explaining it, and ARC reads radio content as a
 * label only.
 */
export function Welcome({ initialSource, onStart }) {
  const [installs, setInstalls] = useState(null);
  const [sources, setSources] = useState([]);
  const [chosen, setChosen] = useState(initialSource || 'wikipedia');
  const [starting, setStarting] = useState(false);
  const startRef = useRef(null);

  async function load() {
    const [found, art] = await Promise.all([
      api.listInstalls().catch(() => []),
      api.artSources().catch(() => ({ sources: [] })),
    ]);
    setInstalls(found);
    setSources(art.sources);
  }

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    if (installs && installs.length && startRef.current) startRef.current.focus();
  }, [installs]);

  async function chooseFolder() {
    const result = await api.addRoot();
    if (result.added) await load();
    else if (result.reason === 'not-a-packages-root') toast('That folder has no Community or StreamedPackages inside it');
  }

  const choices = [
    ...sources.map((source) => ({ id: source.id, label: source.label, note: source.note })),
    { id: 'off', label: 'Off', note: 'No network access at all. Stock aircraft show a placeholder.' },
  ];
  const found = installs && installs.length > 0;

  return (
    <section className="welcome" id="welcome" aria-labelledby="welcome-title">
      {installs && (
        <div className="welcome-panel">
          <header className="welcome-head">
            <span className="brand-mark" aria-hidden="true" />
            <h1 className="welcome-title" id="welcome-title">
              MSFS Quick Viewer
            </h1>
          </header>
          <p className="welcome-lede">
            Every aircraft you have installed, with its liveries, in one grid. It only reads your sim folders and never
            changes them.
          </p>

          <section className="welcome-section">
            <h2 className="welcome-label">{found ? 'Found' : 'No sim found yet'}</h2>
            {found ? (
              <ul className="install-list">
                {installs.map((install) => (
                  <li className="install" key={install.packagesRoot}>
                    <span className="install-name">{installLabel(install)}</span>
                    <span className="install-path mono">{install.packagesRoot}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="welcome-note">
                Steam and Microsoft Store installs of MSFS 2024 and 2020 are found automatically, and none turned up.
                Point the app at your Community folder instead.
              </p>
            )}
            {found ? (
              <button type="button" className="text-action" onClick={chooseFolder}>
                Not the right one? Choose a folder…
              </button>
            ) : (
              <Button variant="secondary" size="sm" onClick={chooseFolder}>
                Choose your Community folder…
              </Button>
            )}
          </section>

          <section className="welcome-section">
            <h2 className="welcome-label">Photos for aircraft without a thumbnail</h2>
            <div className="choice-list" role="radiogroup" aria-label="Photo source">
              {choices.map((choice) => (
                <label className="choice" key={choice.id}>
                  <input
                    type="radio"
                    name="welcome-art-source"
                    value={choice.id}
                    checked={chosen === choice.id}
                    onChange={() => setChosen(choice.id)}
                  />
                  <span className="choice-text">
                    <span className="choice-label">{choice.label}</span>
                    <span className="choice-note">{choice.note}</span>
                  </span>
                </label>
              ))}
            </div>
            <p className="welcome-note">
              Stock aircraft ship encrypted, with no picture on disk. Each is looked up once by name and the photo is
              kept on this PC.
            </p>
          </section>

          <footer className="welcome-foot">
            <p className="welcome-note">You can change any of this later in Settings.</p>
            <Button
              ref={startRef}
              className="welcome-start"
              variant="primary"
              disabled={!found || starting}
              onClick={async () => {
                setStarting(true);
                await onStart(chosen);
              }}
            >
              Scan my aircraft
            </Button>
          </footer>
        </div>
      )}
    </section>
  );
}
