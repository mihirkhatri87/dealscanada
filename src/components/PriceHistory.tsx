import type { PricePoint } from '@/lib/db/types';
import { formatCents } from '@/lib/format';

/**
 * Price history, drawn by hand.
 *
 * A charting library would be a large dependency for one small line, and this
 * needs to do something libraries make awkward anyway: stay readable in both
 * themes and expose the same numbers as text, because a chart a screen reader
 * cannot read is decoration.
 *
 * Every label names a value the line actually reaches, and the viewBox leaves
 * room for the outermost labels so nothing is clipped.
 */

const WIDTH = 640;
const HEIGHT = 200;
const PAD = { top: 16, right: 64, bottom: 28, left: 16 };

export function PriceHistory({
  points,
  currency = 'CAD',
}: {
  points: PricePoint[];
  currency?: string;
}) {
  if (points.length === 0) {
    return (
      <p className="rounded border border-dashed border-border bg-bg-raised px-4 py-6 text-center text-sm text-fg-muted">
        No price history recorded yet. We start tracking a product the first time we see it,
        so a chart appears here once its price moves.
      </p>
    );
  }

  if (points.length === 1) {
    const only = points[0]!;
    return (
      <div className="rounded border border-border bg-bg-raised px-4 py-6 text-center">
        <p className="font-mono text-lg font-semibold">{formatCents(only.price, currency)}</p>
        <p className="mt-1 text-sm text-fg-muted">
          One observation so far, on {formatDate(only.observedAt)}. A trend needs at least two.
        </p>
      </div>
    );
  }

  const prices = points.map((point) => point.price);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  // A flat series would divide by zero; give it a nominal band so the line sits
  // in the middle rather than collapsing onto an edge.
  const span = max - min || Math.max(1, Math.round(max * 0.1));
  const low = max === min ? min - span / 2 : min;

  const plotWidth = WIDTH - PAD.left - PAD.right;
  const plotHeight = HEIGHT - PAD.top - PAD.bottom;

  const x = (index: number) =>
    PAD.left + (points.length === 1 ? plotWidth / 2 : (index / (points.length - 1)) * plotWidth);
  const y = (price: number) => PAD.top + plotHeight - ((price - low) / span) * plotHeight;

  const line = points.map((point, index) => `${x(index)},${y(point.price)}`).join(' ');
  const area = `${PAD.left},${PAD.top + plotHeight} ${line} ${PAD.left + plotWidth},${PAD.top + plotHeight}`;

  const last = points[points.length - 1]!;
  const lowest = points.reduce((best, point) => (point.price < best.price ? point : best));

  return (
    <figure className="m-0 flex flex-col gap-2">
      <div className="overflow-x-auto rounded border border-border bg-bg-raised p-2">
        <svg
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          className="h-auto w-full min-w-[420px]"
          role="img"
          aria-label={`Price history: ${points.length} observations from ${formatCents(
            max,
            currency,
          )} down to ${formatCents(min, currency)}.`}
        >
          {/* Faint band at the recorded low, the value the page actually claims. */}
          <line
            x1={PAD.left}
            x2={PAD.left + plotWidth}
            y1={y(min)}
            y2={y(min)}
            stroke="var(--deal)"
            strokeWidth="1"
            strokeDasharray="3 3"
            opacity="0.5"
          />
          <text
            x={PAD.left + plotWidth + 8}
            y={y(min) + 4}
            fill="var(--deal)"
            fontSize="11"
            fontFamily="ui-monospace, monospace"
          >
            {formatCents(min, currency)}
          </text>

          <text
            x={PAD.left + plotWidth + 8}
            y={y(max) + 4}
            fill="var(--fg-subtle)"
            fontSize="11"
            fontFamily="ui-monospace, monospace"
          >
            {formatCents(max, currency)}
          </text>

          <polygon points={area} fill="var(--accent)" opacity="0.10" />
          <polyline
            points={line}
            fill="none"
            stroke="var(--accent)"
            strokeWidth="2"
            strokeLinejoin="round"
            strokeLinecap="round"
          />

          {points.map((point, index) => (
            <circle
              key={`${point.observedAt}-${index}`}
              cx={x(index)}
              cy={y(point.price)}
              r={point === last || point === lowest ? 4 : 2.5}
              fill={point === lowest ? 'var(--deal)' : 'var(--accent)'}
            />
          ))}

          <text
            x={PAD.left}
            y={HEIGHT - 8}
            fill="var(--fg-subtle)"
            fontSize="11"
            fontFamily="ui-monospace, monospace"
          >
            {formatDate(points[0]!.observedAt)}
          </text>
          <text
            x={PAD.left + plotWidth}
            y={HEIGHT - 8}
            textAnchor="end"
            fill="var(--fg-subtle)"
            fontSize="11"
            fontFamily="ui-monospace, monospace"
          >
            {formatDate(last.observedAt)}
          </text>
        </svg>
      </div>

      {/* The same data as text. The chart is the convenient view, not the only one. */}
      <details className="text-sm">
        <summary className="cursor-pointer text-fg-muted hover:text-fg">
          View {points.length} recorded prices as a table
        </summary>
        <div className="mt-2 overflow-x-auto rounded border border-border">
          <table className="w-full text-sm">
            <caption className="sr-only">Every price observation we have recorded</caption>
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-fg-subtle">
                <th scope="col" className="px-3 py-2 font-medium">
                  Observed
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Price
                </th>
              </tr>
            </thead>
            <tbody>
              {[...points].reverse().map((point, index) => (
                <tr key={`${point.observedAt}-${index}`} className="border-t border-border">
                  <td className="px-3 py-1.5 text-fg-muted">{formatDate(point.observedAt)}</td>
                  <td className="px-3 py-1.5 font-mono tabular-nums">
                    {formatCents(point.price, currency)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return '';
  return date.toLocaleDateString('en-CA', { month: 'short', day: 'numeric' });
}
