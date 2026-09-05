'use client';

import { useEffect, useState } from 'react';

type Theme = 'light' | 'dark' | 'system';

/**
 * Theme toggle.
 *
 * The initial paint is handled by an inline script in the layout, so this only
 * has to reflect and update the stored choice — it never causes the flash it
 * exists to prevent.
 */
export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>('system');

  useEffect(() => {
    try {
      const stored = localStorage.getItem('dc-theme');
      if (stored === 'dark' || stored === 'light') setTheme(stored);
    } catch {
      // Private browsing can throw on access; the system default is fine.
    }
  }, []);

  function apply(next: Theme) {
    setTheme(next);
    try {
      if (next === 'system') {
        localStorage.removeItem('dc-theme');
        delete document.documentElement.dataset.theme;
      } else {
        localStorage.setItem('dc-theme', next);
        document.documentElement.dataset.theme = next;
      }
    } catch {
      // Storage unavailable: the choice still applies for this page view.
      if (next !== 'system') document.documentElement.dataset.theme = next;
    }
  }

  const next: Theme = theme === 'dark' ? 'light' : 'dark';

  return (
    <button
      type="button"
      onClick={() => apply(next)}
      className="rounded-sm border border-border px-2 py-1 text-xs text-fg-muted transition-colors hover:border-border-strong hover:text-fg"
      aria-label={`Switch to ${next} theme`}
    >
      <span aria-hidden="true">{theme === 'dark' ? '☾' : '☀'}</span>
    </button>
  );
}
