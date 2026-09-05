/**
 * The golden evaluation set (S9.7).
 *
 * Assistant quality is invisible without a number. These forty requests are the
 * number: each is a thing a person would actually type, labelled with the seed
 * deals that would satisfy it.
 *
 * Cases are labelled by `sourceId` (`seed-27`), not by deal id or slug — those
 * carry a random suffix and change on every reseed, which would silently rot the
 * labels. `sourceId` is stable and greppable against `src/lib/seed/data.ts`.
 *
 * The train/test split exists so a regression can be fixed without quietly
 * fitting the prompt to the whole set. Iterate on `train`; report on `test`.
 * docs/ASSISTANT-EVAL.md states the procedure.
 */

export type EvalKind =
  /** A request with a right answer: at least one labelled deal must reach the top 6. */
  | 'find'
  /** A request too vague to answer: the assistant should ask before guessing. */
  | 'clarify';

export interface EvalCase {
  id: string;
  request: string;
  kind: EvalKind;
  /** Seed `sourceId`s that satisfy the request. Recall counts a hit on any one. */
  acceptable: string[];
  /**
   * Seed `sourceId`s that must not be presented as a saving. These are the
   * flagged anchors — surfacing one is not merely a miss, it is the specific
   * failure this whole site exists to prevent.
   */
  mustNotRecommend?: string[];
  /** What this case is actually testing, so a regression is diagnosable. */
  probes: string;
  split: 'train' | 'test';
}

export const GOLDEN_SET: EvalCase[] = [
  // ---- Budget constraints -------------------------------------------------
  {
    id: 'budget-coat-child',
    request: "I need a warm winter coat for my 7-year-old, under $80",
    kind: 'find',
    acceptable: ['seed-27', 'seed-28'],
    probes: 'Budget cap plus an age that implies a kids department.',
    split: 'train',
  },
  {
    id: 'budget-headphones',
    request: 'Good noise cancelling headphones for under $400',
    kind: 'find',
    acceptable: ['seed-4'],
    probes: 'Budget cap where only one seed deal qualifies.',
    split: 'test',
  },
  {
    id: 'budget-toy-25',
    request: 'A toy for a kid, spending no more than $25',
    kind: 'find',
    acceptable: ['seed-19', 'seed-21', 'seed-23'],
    probes: 'Low budget across a category rather than a named product.',
    split: 'train',
  },
  {
    id: 'budget-kitchen-150',
    request: 'Something for the kitchen between $80 and $150',
    kind: 'find',
    acceptable: ['seed-42', 'seed-43'],
    probes: 'A price range with both ends bound.',
    split: 'test',
  },
  {
    id: 'budget-tv-under-1400',
    request: 'Looking for a big TV but I cannot go over $1400',
    kind: 'find',
    acceptable: ['seed-0'],
    probes: 'Budget that excludes three of the four listings for the same product.',
    split: 'test',
  },

  // ---- Department ---------------------------------------------------------
  {
    id: 'dept-girls',
    request: 'Show me clothing for girls',
    kind: 'find',
    acceptable: ['seed-27'],
    probes: 'Department facet used directly.',
    split: 'train',
  },
  {
    id: 'dept-boys-hoodie',
    request: 'Hoodie for my son',
    kind: 'find',
    acceptable: ['seed-28'],
    probes: '"my son" must map to the boys department, not a keyword search for "son".',
    split: 'train',
  },
  {
    id: 'dept-womens-work',
    request: 'Something a woman could wear to the office',
    kind: 'find',
    acceptable: ['seed-34', 'seed-33', 'seed-30'],
    probes: 'Department inferred from an occasion rather than stated.',
    split: 'test',
  },
  {
    id: 'dept-baby-gear',
    request: 'What baby gear is on sale?',
    kind: 'find',
    acceptable: ['seed-24', 'seed-25', 'seed-26', 'seed-74'],
    probes: 'Department facet on a non-apparel category.',
    split: 'train',
  },
  {
    id: 'dept-mens-shoes',
    request: "Men's sneakers",
    kind: 'find',
    acceptable: ['seed-37'],
    probes: 'Department combined with a category.',
    split: 'test',
  },

  // ---- Merchant and brand exclusion / inclusion ---------------------------
  {
    id: 'exclude-amazon',
    request: 'An e-reader or a coffee deal, but not from Amazon',
    kind: 'find',
    acceptable: ['seed-43'],
    mustNotRecommend: ['seed-9', 'seed-62'],
    probes: 'Negative merchant constraint — the excluded store must not be recommended.',
    split: 'train',
  },
  {
    id: 'merchant-canadian-tire',
    request: "What's on at Canadian Tire right now?",
    kind: 'find',
    acceptable: ['seed-41', 'seed-49', 'seed-52', 'seed-53', 'seed-68', 'seed-69', 'seed-70'],
    probes: 'A named store, which requires list_facets rather than a guessed slug.',
    split: 'train',
  },
  {
    id: 'merchant-old-navy-kids',
    request: 'Old Navy kids stuff',
    kind: 'find',
    acceptable: ['seed-27', 'seed-28'],
    probes: 'Store plus department together — the classic "Old Navy kids" shape.',
    split: 'test',
  },
  {
    id: 'family-gap-inc',
    request: 'Anything from the Gap family of brands',
    kind: 'find',
    acceptable: ['seed-27', 'seed-28', 'seed-29', 'seed-30', 'seed-31', 'seed-32', 'seed-64'],
    probes: 'Brand family, which only resolves through the family facet.',
    split: 'test',
  },
  {
    id: 'brand-lego',
    request: 'LEGO sets',
    kind: 'find',
    acceptable: ['seed-18'],
    probes: 'Brand name that is also a search term.',
    split: 'train',
  },

  // ---- Discount depth and verification ------------------------------------
  {
    id: 'discount-deep-50',
    request: 'Only show me stuff that is at least 50% off',
    kind: 'find',
    acceptable: ['seed-27', 'seed-28', 'seed-52', 'seed-67', 'seed-68', 'seed-69', 'seed-70', 'seed-71', 'seed-72', 'seed-73', 'seed-74'],
    probes: 'Minimum-discount filter.',
    split: 'train',
  },
  {
    id: 'verified-only',
    request: 'I only want deals you have actually verified are a good price',
    kind: 'find',
    acceptable: ['seed-0', 'seed-4', 'seed-8', 'seed-11', 'seed-14', 'seed-19', 'seed-41', 'seed-51', 'seed-52', 'seed-53', 'seed-56', 'seed-58'],
    mustNotRecommend: ['seed-3'],
    probes: 'The verification verdict is the filter, not the percentage.',
    split: 'train',
  },
  {
    id: 'lowest-ever',
    request: 'Is anything at the lowest price you have ever recorded?',
    kind: 'find',
    acceptable: ['seed-0', 'seed-4', 'seed-8', 'seed-11', 'seed-14', 'seed-19', 'seed-41', 'seed-51', 'seed-52', 'seed-53', 'seed-56', 'seed-58'],
    probes: 'verified-low specifically, which is a stronger claim than verified-good.',
    split: 'test',
  },
  {
    id: 'suspect-anchor-tv',
    request: 'The Source has a QN90D at 40% off — is that a real deal?',
    kind: 'find',
    acceptable: ['seed-0', 'seed-1', 'seed-2'],
    mustNotRecommend: ['seed-3'],
    probes:
      'The headline case for this product: the deepest advertised discount is the ' +
      'inflated anchor, and the assistant must say so rather than lead with it.',
    split: 'train',
  },
  {
    id: 'cheapest-qn90d',
    request: 'Who has the Samsung QN90D 65 inch cheapest?',
    kind: 'find',
    acceptable: ['seed-0'],
    mustNotRecommend: ['seed-3'],
    probes: 'Cross-merchant comparison of one product across four listings.',
    split: 'test',
  },

  // ---- Coupons ------------------------------------------------------------
  {
    id: 'coupon-only',
    request: 'Anything with a coupon code I can use at checkout?',
    kind: 'find',
    acceptable: ['seed-26', 'seed-27', 'seed-28', 'seed-43', 'seed-48', 'seed-59', 'seed-64'],
    probes: 'Coupon-only filter.',
    split: 'train',
  },
  {
    id: 'coupon-under-50',
    request: 'Deals with a promo code under $50',
    kind: 'find',
    acceptable: ['seed-26', 'seed-27', 'seed-28', 'seed-59', 'seed-64'],
    probes: 'Coupon filter composed with a budget.',
    split: 'test',
  },
  {
    id: 'coupon-baby',
    request: 'Is there a code for diapers?',
    kind: 'find',
    acceptable: ['seed-26'],
    probes: 'Coupon plus a specific product word.',
    split: 'train',
  },

  // ---- Local / in-store ---------------------------------------------------
  {
    id: 'local-clearance',
    request: 'What is marked down in stores near me?',
    kind: 'find',
    acceptable: ['seed-68', 'seed-69', 'seed-70', 'seed-71', 'seed-72', 'seed-73', 'seed-74'],
    probes: 'Store-local clearance via find_deals_near_me.',
    split: 'train',
  },
  {
    id: 'local-canadian-tire',
    request: 'Red tag clearance at my Canadian Tire',
    kind: 'find',
    acceptable: ['seed-68', 'seed-69', 'seed-70'],
    probes: 'Local clearance narrowed to one chain.',
    split: 'test',
  },
  {
    id: 'local-sports',
    request: 'Any in-store sports gear clearance?',
    kind: 'find',
    acceptable: ['seed-69', 'seed-70', 'seed-71'],
    probes: 'Local plus category.',
    split: 'train',
  },

  // ---- Category and use-case ----------------------------------------------
  {
    id: 'use-case-gaming-setup',
    request: 'Building a gaming setup, what should I grab?',
    kind: 'find',
    acceptable: ['seed-13', 'seed-15', 'seed-17', 'seed-66'],
    probes: 'A use case that maps to a category rather than a product name.',
    split: 'train',
  },
  {
    id: 'use-case-camping',
    request: 'Going camping this weekend',
    kind: 'find',
    acceptable: ['seed-56', 'seed-57', 'seed-54', 'seed-69'],
    probes: 'Activity implying a category with no explicit filter words.',
    split: 'test',
  },
  {
    id: 'use-case-new-apartment',
    request: 'Just moved into an empty apartment, what furniture is cheap right now?',
    kind: 'find',
    acceptable: ['seed-47', 'seed-48', 'seed-46'],
    probes: 'Life event implying home goods.',
    split: 'train',
  },
  {
    id: 'use-case-winter-tires',
    request: 'Time to put winter tires on',
    kind: 'find',
    acceptable: ['seed-53'],
    probes: 'Seasonal need matching one specific listing.',
    split: 'test',
  },
  {
    id: 'category-laptop',
    request: 'Show me laptop deals',
    kind: 'find',
    acceptable: ['seed-10'],
    probes: 'Plain category request.',
    split: 'train',
  },
  {
    id: 'category-skincare',
    request: 'Skincare or moisturizer on sale',
    kind: 'find',
    acceptable: ['seed-58', 'seed-61'],
    probes: 'Beauty category with two acceptable answers.',
    split: 'test',
  },
  {
    id: 'category-vacuum',
    request: 'I want a cordless vacuum',
    kind: 'find',
    acceptable: ['seed-45'],
    probes: 'Specific appliance.',
    split: 'train',
  },
  {
    id: 'gift-teenager',
    request: 'Gift for a teenager, around $100 or less',
    kind: 'find',
    acceptable: ['seed-12', 'seed-22', 'seed-37', 'seed-50', 'seed-66', 'seed-67'],
    probes: 'Open-ended gift request with a budget — should search, not clarify.',
    split: 'test',
  },
  {
    id: 'stacked-promo',
    request: 'Is there a sitewide sale anywhere?',
    kind: 'find',
    acceptable: ['seed-64'],
    probes: 'A promotion with no product price of its own.',
    split: 'train',
  },

  // ---- Deliberately vague: should ask, not guess --------------------------
  {
    id: 'vague-gift',
    request: 'I need a gift',
    kind: 'clarify',
    acceptable: [],
    probes: 'No recipient, no budget, no category. Guessing here is a wrong answer.',
    split: 'train',
  },
  {
    id: 'vague-something-good',
    request: 'find me something good',
    kind: 'clarify',
    acceptable: [],
    probes: 'Maximally underspecified.',
    split: 'train',
  },
  {
    id: 'vague-shopping',
    request: 'I want to go shopping',
    kind: 'clarify',
    acceptable: [],
    probes: 'An intent with no object at all.',
    split: 'test',
  },
  {
    id: 'vague-cheap',
    request: 'whats cheap',
    kind: 'clarify',
    acceptable: [],
    probes: 'A constraint with no category — cheap relative to what?',
    split: 'test',
  },
  {
    id: 'vague-present-for-them',
    request: 'looking for a present for them',
    kind: 'clarify',
    acceptable: [],
    probes: 'A recipient with no attributes; the age or interest is the missing key.',
    split: 'test',
  },
];
