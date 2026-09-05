import { randomUUID } from 'node:crypto';
import type { DealInput } from '../db/repository';
import type { Category, Department } from '../db/types';
import type { RawDeal } from '../sources/types';
import { computeDiscount, parsePriceToCents } from '../util/money';
import { canonicalizeUrl, extractAsin, extractDomain } from '../util/url';
import { classifyCategory, classifyDepartment } from './classify';
import { resolveProductIdentity } from './product-key';
import { extractCouponFrom } from './coupon';
import { computeHeat } from './score';

/** Marketing decoration that carries no information about the product. */
const TITLE_NOISE = [
  /^\s*\[?(?:expired|dead|hot|deal|sale|update|ymmv)\]?\s*[:—-]?\s*/i,
  /\s*\[(?:expired|dead|update|ymmv)\]\s*/gi,
  /\*{2,}/g,
  /\p{Extended_Pictographic}/gu,
];

/** Cleans a source title without discarding the words a shopper searches for. */
export function cleanTitle(title: string): string {
  let cleaned = title;
  for (const pattern of TITLE_NOISE) cleaned = cleaned.replace(pattern, ' ');

  return cleaned
    .replace(/\s{2,}/g, ' ')
    .replace(/^[\s:—-]+|[\s:—-]+$/g, '')
    .trim();
}

/** Trims to a length that fits a two-line card, cutting on a word boundary. */
export function trimDescription(text: string | null | undefined, max = 220): string | null {
  if (!text) return null;

  const stripped = text
    .replace(/<[^>]*>/g, ' ')
    .replace(/&(?:nbsp|amp|quot|#39|lt|gt);/g, (entity) => {
      const map: Record<string, string> = {
        '&nbsp;': ' ',
        '&amp;': '&',
        '&quot;': '"',
        '&#39;': "'",
        '&lt;': '<',
        '&gt;': '>',
      };
      return map[entity] ?? ' ';
    })
    .replace(/\s{2,}/g, ' ')
    .trim();

  if (stripped === '') return null;
  if (stripped.length <= max) return stripped;

  const cut = stripped.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

/** URL-safe slug, with a short suffix so two same-titled deals cannot collide. */
export function slugify(title: string, suffix: string): string {
  const base = title
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 70)
    .replace(/-+$/g, '');

  return `${base || 'deal'}-${suffix.slice(0, 6)}`;
}

export interface NormalizeContext {
  source: string;
  /** Resolves a domain to a merchant id, creating one when unseen. */
  resolveMerchant: (
    domain: string | null,
    name: string | null,
  ) => { id: string; slug: string } | null;
  now?: Date;
}

export interface NormalizeOutcome {
  deal: DealInput | null;
  /** Why the item was dropped, for the run summary. */
  dropReason?: string;
}

/**
 * RawDeal -> DealInput.
 *
 * Everything a source claims passes through the same guards here, so an adapter
 * cannot introduce a fabricated price or an unparseable URL into the database.
 */
export function normalizeDeal(raw: RawDeal, context: NormalizeContext): NormalizeOutcome {
  const now = context.now ?? new Date();

  const title = cleanTitle(raw.title);
  if (title.length < 3) return { deal: null, dropReason: 'title too short after cleaning' };

  const canonicalUrl = canonicalizeUrl(raw.url);
  if (!/^https?:\/\//i.test(canonicalUrl)) {
    return { deal: null, dropReason: 'url is not absolute' };
  }

  const domain = raw.merchantDomain ?? extractDomain(canonicalUrl);
  const merchant = context.resolveMerchant(domain, raw.merchantName ?? null);

  const priceNow = parsePriceToCents(raw.price ?? null);
  const priceWasRaw = parsePriceToCents(raw.priceWas ?? null);
  const { discountPct, discountAbs, priceWas } = computeDiscount(priceNow, priceWasRaw);

  // A source-supplied code is authoritative; otherwise look in the text.
  const extracted = extractCouponFrom(title, raw.description ?? null);
  const couponCode = raw.couponCode?.trim().toUpperCase() || extracted.code;
  const description = trimDescription(
    extracted.code && !raw.couponCode ? extracted.cleanedText : raw.description,
  );

  const category: Category = classifyCategory({
    title,
    description,
    merchantSlug: merchant?.slug ?? null,
    sourceHint: raw.categoryHint ?? null,
  });

  const department: Department = classifyDepartment({
    title,
    description,
    sourceHint: raw.departmentHint ?? null,
    category,
  });

  // Identity for cross-merchant comparison. Resolved at ingest so the
  // verification pass can group the same product across every source.
  const identity = resolveProductIdentity({
    title,
    brand: raw.brand ?? null,
    gtin: raw.gtin ?? null,
    mpn: raw.mpn ?? null,
    asin: raw.asin ?? extractAsin(canonicalUrl),
  });

  const id = randomUUID();
  const postedAt = normalizeTimestamp(raw.postedAt) ?? now.toISOString();
  const expiresAt = normalizeTimestamp(raw.expiresAt);
  const votes = Math.max(0, Math.round(raw.votes ?? 0));

  const heat = computeHeat({
    votes,
    discountPct,
    postedAt,
    source: context.source,
    now,
  });

  return {
    deal: {
      id,
      source: context.source,
      sourceId: raw.sourceId,
      slug: slugify(title, id),
      url: raw.url,
      canonicalUrl,
      title,
      description,
      imageUrl: normalizeImageUrl(raw.imageUrl),
      merchantId: merchant?.id ?? null,
      storeId: raw.storeId ?? null,
      category,
      department,
      brand: raw.brand?.trim() || null,
      sizesAvailable: raw.sizesAvailable?.length ? raw.sizesAvailable : null,
      productKey: identity.key,
      productKeyStrength: identity.strength,
      gtin: raw.gtin?.replace(/\D/g, '') || null,
      mpn: raw.mpn?.trim() || null,
      asin: raw.asin ?? extractAsin(canonicalUrl),
      priceNow,
      priceWas,
      currency: (raw.currency ?? 'CAD').toUpperCase(),
      // The retailer's CLAIM. The verification pass (verify.ts) replaces the
      // fields below with what we can actually corroborate.
      discountPct,
      discountAbs,
      marketPrice: null,
      marketDiscountPct: null,
      observedLow: null,
      priceRankPct: null,
      verdict: 'unverified',
      evidence: 'none',
      claimSuspect: false,
      qualityNote: null,
      couponCode: couponCode || null,
      couponNote: couponCode ? (extracted.note ?? 'Use code at checkout') : null,
      shippingNote: raw.shippingNote?.trim() || null,
      inStock: raw.inStock ?? true,
      stockNote: raw.stockNote?.trim() || null,
      postedAt,
      expiresAt,
      votes,
      heat,
      status: 'active',
      locale: 'en-CA',
      alsoSeenOn: null,
      sourcePath: raw.sourcePath ?? null,
    },
  };
}

/** Accepts ISO strings and Unix seconds/milliseconds; returns ISO or null. */
export function normalizeTimestamp(value: string | null | undefined): string | null {
  if (!value) return null;

  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) {
    // Ten digits is seconds, thirteen is milliseconds.
    const ms = numeric < 1e11 ? numeric * 1000 : numeric;
    const date = new Date(ms);
    return Number.isFinite(date.getTime()) ? date.toISOString() : null;
  }

  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

/** Upgrades protocol-relative URLs and rejects anything not fetchable as an image. */
export function normalizeImageUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const trimmed = url.trim();
  if (trimmed === '') return null;

  if (trimmed.startsWith('//')) return `https:${trimmed}`;
  if (!/^https?:\/\//i.test(trimmed)) return null;

  return trimmed.replace(/^http:\/\//i, 'https://');
}
