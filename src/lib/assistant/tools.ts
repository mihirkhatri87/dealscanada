import { z } from 'zod';
import type { DealRepository } from '../db/repository';
import type { DealQuery, DealWithRelations, FacetValue } from '../db/types';
import { CATEGORIES, DEPARTMENTS } from '../db/types';
import { formatCents } from '../util/money';

/**
 * The assistant's tool layer.
 *
 * Every tool is a thin wrapper over the same DealRepository the FilterBar uses.
 * That is the whole grounding mechanism: the assistant has no way to put a
 * product on screen except by asking for real rows, so it cannot invent a deal,
 * a price, or a store. There is deliberately no tool that writes, spends money,
 * or reaches the network.
 */

const dealQuerySchema = z.object({
  search: z.string().max(200).optional().describe('Free-text search over title, brand and store'),
  categories: z.array(z.enum(CATEGORIES)).optional(),
  departments: z.array(z.enum(DEPARTMENTS)).optional(),
  merchantSlugs: z.array(z.string().max(60)).optional().describe('Store slugs from list_facets'),
  families: z.array(z.string().max(60)).optional().describe('Brand families, e.g. gap-inc'),
  brands: z.array(z.string().max(60)).optional(),
  minPriceDollars: z.number().min(0).max(100000).optional(),
  maxPriceDollars: z.number().min(0).max(100000).optional(),
  minDiscountPct: z.number().min(0).max(100).optional(),
  couponOnly: z.boolean().optional(),
  inStockOnly: z.boolean().optional(),
  verifiedOnly: z
    .boolean()
    .optional()
    .describe('Only deals corroborated against other stores or our price history'),
  excludeSuspect: z.boolean().optional().describe('Exclude deals with an inflated "was" price'),
  sort: z
    .enum(['hottest', 'best-verified', 'newest', 'biggest-drop', 'price-asc', 'price-desc'])
    .optional(),
  limit: z.number().int().min(1).max(24).optional(),
});

export type AssistantDealQuery = z.infer<typeof dealQuerySchema>;

/** Prices are dollars at the tool boundary and cents everywhere inside. */
export function toDealQuery(input: AssistantDealQuery): DealQuery {
  return {
    search: input.search,
    categories: input.categories,
    departments: input.departments,
    merchantSlugs: input.merchantSlugs,
    families: input.families,
    brands: input.brands,
    minPrice:
      input.minPriceDollars === undefined ? undefined : Math.round(input.minPriceDollars * 100),
    maxPrice:
      input.maxPriceDollars === undefined ? undefined : Math.round(input.maxPriceDollars * 100),
    minDiscountPct: input.minDiscountPct,
    couponOnly: input.couponOnly,
    inStockOnly: input.inStockOnly,
    verifiedOnly: input.verifiedOnly,
    excludeSuspect: input.excludeSuspect,
    sort: input.sort,
    limit: input.limit ?? 12,
  };
}

/**
 * Compact deal summary.
 *
 * Deliberately not the full row: the model needs enough to reason and cite, and
 * every extra field is tokens spent on every turn. Prices are pre-formatted so
 * the model never does currency arithmetic itself.
 */
export interface DealSummary {
  id: string;
  title: string;
  store: string;
  price: string;
  wasPrice: string | null;
  discountPct: number | null;
  verdict: string;
  verdictNote: string | null;
  category: string;
  department: string;
  brand: string | null;
  coupon: string | null;
  inStock: boolean;
  storeLocation: string | null;
}

export function summarizeDeal(deal: DealWithRelations): DealSummary {
  return {
    id: deal.id,
    title: deal.title,
    store: deal.merchant?.name ?? 'Unknown store',
    price: formatCents(deal.priceNow, deal.currency),
    // Suppressed on a flagged anchor, exactly as the UI suppresses it, so the
    // model is never handed a number the interface refuses to display.
    wasPrice:
      deal.priceWas !== null && deal.verdict !== 'inflated-anchor'
        ? formatCents(deal.priceWas, deal.currency)
        : null,
    discountPct:
      deal.verdict === 'inflated-anchor' ? null : (deal.marketDiscountPct ?? deal.discountPct),
    verdict: deal.verdict,
    verdictNote: deal.qualityNote,
    category: deal.category,
    department: deal.department,
    brand: deal.brand,
    coupon: deal.couponCode,
    inStock: deal.inStock,
    storeLocation: deal.store
      ? `${deal.store.name}${deal.distanceKm !== undefined ? ` (${deal.distanceKm.toFixed(1)} km)` : ''}`
      : null,
  };
}

export interface ToolContext {
  repo: DealRepository;
  /** Ids returned to the model this session, for the grounding check. */
  seenDealIds: Set<string>;
  location?: { lat: number; lng: number; label: string } | null;
}

export interface ToolResult {
  /** Rendered to the user as an activity chip. */
  activity: string;
  /** Returned to the model. */
  content: unknown;
  /** UI state patch, when the tool changes what the canvas shows. */
  patch?: { deals?: DealWithRelations[]; query?: DealQuery; view?: string; focusId?: string };
}

/** Caps how many rows one call can return, bounding tokens per turn. */
const MAX_RESULTS = 12;

export const TOOL_DEFINITIONS = [
  {
    name: 'search_deals',
    description:
      'Search the deal database and show the results to the user. This is the only way ' +
      'to display deals. Always call this rather than describing deals from memory.',
    schema: dealQuerySchema,
  },
  {
    name: 'list_facets',
    description:
      'List the real values available for a field (stores, brands, categories, departments, ' +
      'families) with counts. Call this before filtering by a store or brand so you use a ' +
      'value that actually exists rather than guessing a name.',
    schema: z.object({
      field: z.enum(['merchant', 'brand', 'category', 'department', 'family']),
    }),
  },
  {
    name: 'get_price_history',
    description:
      'Recorded price observations for one deal, to judge whether the current price is ' +
      'genuinely good rather than repeating the retailer’s claim.',
    schema: z.object({ dealId: z.string() }),
  },
  {
    name: 'compare_deals',
    description: 'Show two or more deals side by side in a comparison table.',
    schema: z.object({ dealIds: z.array(z.string()).min(2).max(6) }),
  },
  {
    name: 'show_deal',
    description: 'Focus a single deal in the results canvas.',
    schema: z.object({ dealId: z.string() }),
  },
  {
    name: 'find_deals_near_me',
    description:
      'In-store clearance near the user’s saved location. Only useful when the user has ' +
      'set a location; it returns a reason when they have not.',
    schema: z.object({ radiusKm: z.number().min(1).max(100).optional() }),
  },
] as const;

export type ToolName = (typeof TOOL_DEFINITIONS)[number]['name'];

/**
 * Executes a tool call.
 *
 * Never throws on bad model input: an invalid argument comes back as a message
 * the model can correct on its next turn, which is far better than failing the
 * whole conversation.
 */
export async function executeTool(
  name: string,
  rawInput: unknown,
  context: ToolContext,
): Promise<ToolResult> {
  switch (name) {
    case 'search_deals': {
      const parsed = dealQuerySchema.safeParse(rawInput);
      if (!parsed.success) {
        return {
          activity: 'Search failed',
          content: { error: `Invalid search: ${parsed.error.issues[0]?.message ?? 'bad input'}` },
        };
      }

      const query = toDealQuery(parsed.data);
      const { deals, total } = await context.repo.queryDeals(query);
      for (const deal of deals) context.seenDealIds.add(deal.id);

      return {
        activity: `Searched deals → ${total} ${total === 1 ? 'match' : 'matches'}`,
        content: {
          totalMatches: total,
          showing: deals.length,
          deals: deals.slice(0, MAX_RESULTS).map(summarizeDeal),
          // Telling the model the result was empty, and why, is what lets it
          // suggest relaxing a filter instead of inventing something.
          note:
            total === 0
              ? 'No deals matched. Suggest relaxing a filter rather than describing deals that do not exist.'
              : undefined,
        },
        patch: { deals, query, view: 'grid' },
      };
    }

    case 'list_facets': {
      const parsed = z
        .object({ field: z.enum(['merchant', 'brand', 'category', 'department', 'family']) })
        .safeParse(rawInput);
      if (!parsed.success) {
        return { activity: 'Lookup failed', content: { error: 'Unknown field' } };
      }

      const facets: FacetValue[] = await context.repo.facets(parsed.data.field);
      return {
        activity: `Checked available ${parsed.data.field}s`,
        content: {
          field: parsed.data.field,
          // Every value here is guaranteed to return results, so the model
          // cannot filter itself into an empty grid.
          values: facets.slice(0, 60),
        },
      };
    }

    case 'get_price_history': {
      const parsed = z.object({ dealId: z.string() }).safeParse(rawInput);
      if (!parsed.success)
        return { activity: 'Lookup failed', content: { error: 'Missing dealId' } };

      const [deal] = await context.repo.getDealsByIds([parsed.data.dealId]);
      if (!deal) return { activity: 'Lookup failed', content: { error: 'No such deal' } };

      const history = await context.repo.getPriceHistory(deal.id);
      return {
        activity: `Checked price history for ${deal.title.slice(0, 40)}`,
        content: {
          dealId: deal.id,
          currentPrice: formatCents(deal.priceNow, deal.currency),
          verdict: deal.verdict,
          verdictNote: deal.qualityNote,
          observedLow: deal.observedLow === null ? null : formatCents(deal.observedLow),
          marketPrice: deal.marketPrice === null ? null : formatCents(deal.marketPrice),
          observations: history.map((point) => ({
            price: formatCents(point.price),
            observedAt: point.observedAt.slice(0, 10),
          })),
        },
      };
    }

    case 'compare_deals': {
      const parsed = z.object({ dealIds: z.array(z.string()).min(2).max(6) }).safeParse(rawInput);
      if (!parsed.success) {
        return {
          activity: 'Comparison failed',
          content: { error: 'Need between 2 and 6 deal ids' },
        };
      }

      const deals = await context.repo.getDealsByIds(parsed.data.dealIds);
      for (const deal of deals) context.seenDealIds.add(deal.id);

      return {
        activity: `Compared ${deals.length} deals`,
        content: { deals: deals.map(summarizeDeal) },
        patch: { deals, view: 'comparison' },
      };
    }

    case 'show_deal': {
      const parsed = z.object({ dealId: z.string() }).safeParse(rawInput);
      if (!parsed.success) return { activity: 'Failed', content: { error: 'Missing dealId' } };

      const [deal] = await context.repo.getDealsByIds([parsed.data.dealId]);
      if (!deal) return { activity: 'Failed', content: { error: 'No such deal' } };
      context.seenDealIds.add(deal.id);

      return {
        activity: `Showing ${deal.title.slice(0, 40)}`,
        content: { deal: summarizeDeal(deal) },
        patch: { deals: [deal], view: 'single', focusId: deal.id },
      };
    }

    case 'find_deals_near_me': {
      if (!context.location) {
        return {
          activity: 'No location set',
          content: {
            error: 'no_location',
            message:
              'The user has not set a location. Ask them for a postal code or city, or point ' +
              'them at the "Set location" control — do not guess where they are.',
          },
        };
      }

      const parsed = z
        .object({ radiusKm: z.number().min(1).max(100).optional() })
        .safeParse(rawInput);
      const radiusKm = parsed.success ? (parsed.data.radiusKm ?? 25) : 25;

      const { deals, total } = await context.repo.queryDealsNear({
        lat: context.location.lat,
        lng: context.location.lng,
        radiusKm,
        limit: MAX_RESULTS,
      });
      for (const deal of deals) context.seenDealIds.add(deal.id);

      return {
        activity: `Checked stores near ${context.location.label} → ${total} in-store deals`,
        content: {
          location: context.location.label,
          radiusKm,
          totalMatches: total,
          deals: deals.map(summarizeDeal),
        },
        patch: { deals, view: 'grid' },
      };
    }

    default:
      return { activity: 'Unknown tool', content: { error: `No tool named ${name}` } };
  }
}
