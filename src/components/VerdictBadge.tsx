import type { DealVerdict, EvidenceLevel } from '@/lib/db/types';
import { presentEvidence, presentVerdict } from '@/lib/format';

/**
 * The verdict badge.
 *
 * This is the most important element on a deal card, because it is the one thing
 * no other Canadian deal site shows. Tone is semantic — separate from the brand
 * accent — so "cheaper elsewhere" and "inflated claim" read differently at a
 * glance without relying on colour alone: each tone also carries its own glyph.
 */

const TONE_CLASSES: Record<string, string> = {
  good: 'bg-deal-subtle text-deal',
  neutral: 'bg-bg-inset text-fg-muted',
  caution: 'bg-warn-subtle text-warn',
  alert: 'bg-hot-subtle text-hot',
};

const TONE_GLYPHS: Record<string, string> = {
  good: '✓',
  neutral: '·',
  caution: '!',
  alert: '⚠',
};

export function VerdictBadge({
  verdict,
  evidence,
  size = 'sm',
}: {
  verdict: DealVerdict;
  evidence?: EvidenceLevel;
  size?: 'sm' | 'md';
}) {
  const { label, tone, short } = presentVerdict(verdict);

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-sm font-medium ${TONE_CLASSES[tone]} ${
        size === 'sm' ? 'px-1.5 py-0.5 text-[11px]' : 'px-2.5 py-1 text-sm'
      }`}
      title={evidence ? `${label} — ${presentEvidence(evidence)}` : label}
    >
      <span aria-hidden="true" className="font-semibold">
        {TONE_GLYPHS[tone]}
      </span>
      {size === 'sm' ? short : label}
    </span>
  );
}
