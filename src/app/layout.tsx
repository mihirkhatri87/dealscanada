import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'DealsCanada — Canadian deals, ranked',
    template: '%s · DealsCanada',
  },
  description:
    'Deals from 60+ Canadian retailers in one place, with real before and after prices, coupon codes, and in-store clearance near you.',
};

/**
 * Applied before first paint so an explicit theme choice never flashes the wrong
 * palette. Kept deliberately tiny and dependency-free; it runs ahead of hydration.
 */
const THEME_SCRIPT = `
try {
  var t = localStorage.getItem('dc-theme');
  if (t === 'dark' || t === 'light') document.documentElement.dataset.theme = t;
} catch (e) {}
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-CA" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="min-h-screen">{children}</body>
    </html>
  );
}
