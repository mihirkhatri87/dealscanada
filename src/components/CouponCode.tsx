'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Click-to-copy coupon code.
 *
 * The confirmation is announced through an aria-live region as well as shown,
 * because "did that copy?" is invisible to a screen reader otherwise — and this
 * control's entire purpose is an effect the user cannot see.
 */
export function CouponCode({ code, className = '' }: { code: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  async function copy(event: React.MouseEvent) {
    // The card is a link; copying must not navigate.
    event.preventDefault();
    event.stopPropagation();

    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access can be denied. Select the text instead of failing
      // silently, so the code is still obtainable.
      setCopied(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={copy}
        className={`group inline-flex items-center gap-1.5 rounded-sm border border-dashed border-border-strong bg-bg-inset px-2 py-1 font-mono text-xs font-medium tracking-wide text-fg transition-colors hover:border-accent hover:text-accent ${className}`}
        aria-label={`Copy coupon code ${code}`}
      >
        {code}
        <span aria-hidden="true" className="text-fg-subtle group-hover:text-accent">
          {copied ? '✓' : '⧉'}
        </span>
      </button>
      <span role="status" aria-live="polite" className="sr-only">
        {copied ? `Coupon code ${code} copied to clipboard` : ''}
      </span>
    </>
  );
}
