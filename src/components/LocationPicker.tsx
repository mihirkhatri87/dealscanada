'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { resolveLocation } from '@/lib/util/fsa';
import { isValidPostalInput } from '@/lib/util/geo';
import { LOCATION_COOKIE, encodeLocation, type StoredLocation } from '@/lib/location';

/**
 * Location entry.
 *
 * Browser geolocation first, with a postal code or city as the fallback — and
 * denying the permission prompt must land on the manual input, never an error.
 * Resolution is local: the postal code is matched against a bundled table, so no
 * coordinate is ever sent anywhere.
 */
export function LocationPicker({ current }: { current: StoredLocation | null }) {
  const router = useRouter();
  const [input, setInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function save(location: StoredLocation) {
    // A year, path-wide, Lax: this is a preference, not a session token.
    document.cookie = `${LOCATION_COOKIE}=${encodeLocation(location)}; path=/; max-age=31536000; SameSite=Lax`;
    try {
      localStorage.setItem(LOCATION_COOKIE, JSON.stringify(location));
    } catch {
      // Private browsing can refuse storage; the cookie alone still works.
    }
    router.refresh();
  }

  function useGps() {
    if (!('geolocation' in navigator)) {
      setError('This browser cannot share your location. Enter a postal code instead.');
      return;
    }

    setBusy(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setBusy(false);
        setError(null);
        save({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          label: 'Your location',
          precision: 'gps',
          storeIds: current?.storeIds,
        });
      },
      () => {
        // Denial is an ordinary choice, not a failure state.
        setBusy(false);
        setError('No problem — enter a postal code or city instead.');
      },
      { timeout: 10_000, maximumAge: 600_000 },
    );
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = input.trim();

    if (trimmed === '') {
      setError('Enter a postal code or city.');
      return;
    }

    const resolved = resolveLocation(trimmed);
    if (!resolved) {
      setError(
        isValidPostalInput(trimmed)
          ? "That postal code looks valid but isn't in our lookup table yet. Try your city instead."
          : 'Enter a Canadian postal code (like M5V 3L9) or a city name.',
      );
      return;
    }

    setError(null);
    save({ ...resolved, storeIds: current?.storeIds });
  }

  return (
    <div className="flex flex-col gap-3 rounded border border-border bg-bg-raised p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">
          {current ? `Showing deals near ${current.label}` : 'Where are you shopping?'}
        </h2>
        {current && (
          <button
            type="button"
            onClick={() => {
              document.cookie = `${LOCATION_COOKIE}=; path=/; max-age=0`;
              try {
                localStorage.removeItem(LOCATION_COOKIE);
              } catch {
                /* storage unavailable */
              }
              router.refresh();
            }}
            className="text-xs text-fg-muted underline-offset-2 hover:text-fg hover:underline"
          >
            Clear
          </button>
        )}
      </div>

      <form onSubmit={submit} className="flex flex-wrap gap-2">
        <label htmlFor="location-input" className="sr-only">
          Postal code or city
        </label>
        <input
          id="location-input"
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder="M5V 3L9 or Toronto"
          autoComplete="postal-code"
          className="min-w-0 flex-1 rounded border border-border bg-bg px-3 py-1.5 text-sm placeholder:text-fg-subtle focus:border-accent focus:outline-none"
          aria-describedby={error ? 'location-error' : undefined}
          aria-invalid={error ? true : undefined}
        />
        <button
          type="submit"
          className="rounded bg-accent px-3 py-1.5 text-sm font-medium text-accent-fg hover:opacity-90"
        >
          Set
        </button>
        <button
          type="button"
          onClick={useGps}
          disabled={busy}
          className="rounded border border-border px-3 py-1.5 text-sm text-fg-muted hover:border-accent hover:text-accent disabled:opacity-60"
        >
          {busy ? 'Locating…' : 'Use my location'}
        </button>
      </form>

      {error && (
        <p id="location-error" role="status" className="text-xs text-warn">
          {error}
        </p>
      )}

      <p className="text-xs text-fg-subtle">
        Your location stays in this browser. Postal codes are matched against a list bundled
        with the site, so nothing is sent to a mapping service.
      </p>
    </div>
  );
}
