'use client';
import { useState, type ReactNode } from 'react';

export interface DevScenario {
  id: string;
  label: string;
  description: string;
}

/**
 * Mock-mode developer panel (Phase 1). Lets testers switch named mock scenarios and reset data.
 * Rendered only when the app runs in mock mode.
 */
export function DevPanel({
  scenarios,
  current,
  onSelect,
  onReset,
  children,
}: {
  scenarios: DevScenario[];
  current: string;
  onSelect: (id: string) => void;
  onReset: () => void;
  children?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const active = scenarios.find((s) => s.id === current);
  return (
    <div className="fixed bottom-4 right-4 z-50 text-sm">
      {open ? (
        <div
          className="w-80 rounded-xl border border-border bg-surface p-4 shadow-xl"
          role="dialog"
          aria-label="Mock scenarios"
        >
          <div className="mb-3 flex items-center justify-between">
            <p className="font-semibold text-text">Mock scenario</p>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded px-2 text-text-muted hover:bg-surface-muted"
              aria-label="Close"
            >
              ×
            </button>
          </div>
          <label className="mb-1 block text-xs text-text-muted" htmlFor="hb-scenario">
            Scenario (resets mock data)
          </label>
          <select
            id="hb-scenario"
            value={current}
            onChange={(e) => onSelect(e.target.value)}
            className="mb-2 h-9 w-full rounded-md border border-border-strong bg-surface px-2 text-text"
          >
            {scenarios.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
          {active && <p className="mb-3 text-xs text-text-muted">{active.description}</p>}
          {children}
          <button
            type="button"
            onClick={onReset}
            className="mt-2 w-full rounded-md border border-border-strong px-3 py-1.5 font-medium text-text hover:bg-surface-muted"
          >
            Reset mock data
          </button>
          <p className="mt-3 text-[11px] text-text-muted">
            Mock mode: data is simulated in this browser. Server behaviour is not verified in Phase
            1.
          </p>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="rounded-full border border-warning-border bg-warning-bg px-3 py-1.5 font-medium text-warning-fg shadow"
          aria-label={`Mock mode — scenario ${active?.label ?? current}`}
        >
          Mock · {active?.label ?? current}
        </button>
      )}
    </div>
  );
}
