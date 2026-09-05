import { describe, expect, it, vi } from 'vitest';
import {
  buildPostsUrl,
  createWordPressAdapter,
  extractPrices,
  featuredImage,
  parseWordPressPosts,
} from '@/lib/sources/engines/wordpress';
import type { RetailerConfig } from '@/lib/sources/catalogue';

/**
 * Deal blogs are editorial sites, not storefronts. The judgement this engine has
 * to get right is which posts are deals at all — a roundup with no prices is an
 * article, and a card for it would make a claim the post does not support.
 */

const POSTS = [
  {
    id: 101,
    link: 'https://www.cocowest.ca/2026/03/kirkland-olive-oil/',
    title: { rendered: 'Kirkland Olive Oil $12.99 (was $19.99)' },
    excerpt: { rendered: '<p>Sale price $12.99, regular $19.99. Ends Sunday.</p>' },
    content: { rendered: '<p>More detail here.</p>' },
    date_gmt: '2026-03-01T10:00:00',
    _embedded: { 'wp:featuredmedia': [{ source_url: 'https://www.cocowest.ca/img.jpg' }] },
  },
  {
    id: 102,
    link: 'https://www.cocowest.ca/2026/03/weekly-roundup/',
    title: { rendered: 'What&#8217;s new at Costco this week' },
    excerpt: { rendered: '<p>A roundup with no prices at all.</p>' },
    content: { rendered: '' },
  },
  {
    id: 103,
    link: 'https://www.smartcanucks.ca/2026/03/coupon/',
    title: { rendered: 'Save on detergent: $4.99 from $8.99, use code CLEAN20' },
    excerpt: { rendered: '<p>Was $8.99, now $4.99 with code CLEAN20.</p>' },
    content: { rendered: '<p><img src="https://www.smartcanucks.ca/inline.jpg" /></p>' },
  },
  {
    id: 104,
    link: 'https://www.cocowest.ca/2026/03/single-price/',
    title: { rendered: 'New item spotted at $24.99' },
    excerpt: { rendered: '<p>Just one price mentioned.</p>' },
    content: { rendered: '' },
  },
];

const options = { merchantDomain: 'cocowest.ca', merchantName: 'Costco West Fan Blog' };

function config(overrides: Partial<RetailerConfig> = {}): RetailerConfig {
  return {
    id: 'cocowest',
    name: 'Costco West Fan Blog',
    domain: 'cocowest.ca',
    baseUrl: 'https://www.cocowest.ca',
    engine: 'wordpress',
    status: 'unverified',
    enabled: true,
    ...overrides,
  } as RetailerConfig;
}

describe('deciding which posts are deals', () => {
  it('emits a post that states both prices', () => {
    const deals = parseWordPressPosts(POSTS, options);
    const deal = deals.find((d) => d.title.includes('Olive Oil'));

    expect(deal?.price).toBe(12.99);
    expect(deal?.priceWas).toBe(19.99);
  });

  it('skips a roundup with no prices rather than listing it priceless', () => {
    const titles = parseWordPressPosts(POSTS, options).map((d) => d.title);
    expect(titles).not.toContain("What's new at Costco this week");
  });

  it('skips a post that names one price, because the other would be invented', () => {
    const titles = parseWordPressPosts(POSTS, options).map((d) => d.title);
    expect(titles.some((title) => title.includes('New item spotted'))).toBe(false);
  });

  it('extracts a coupon code, which is what these blogs are actually for', () => {
    const deal = parseWordPressPosts(POSTS, options).find((d) => d.title.includes('detergent'));
    expect(deal?.couponCode).toBe('CLEAN20');
  });

  it('decodes entities and strips markup from the title', () => {
    const titles = parseWordPressPosts(POSTS, options).map((d) => d.title);
    for (const title of titles) {
      expect(title).not.toContain('&#');
      expect(title).not.toContain('<');
    }
  });

  it('says the price is reported rather than observed', () => {
    // Editorial coverage is not a retailer's own feed, and the card should not
    // imply it is.
    for (const deal of parseWordPressPosts(POSTS, options)) {
      expect(deal.stockNote).toContain('confirm in store');
    }
  });

  it('returns nothing for a non-array payload', () => {
    expect(parseWordPressPosts({ posts: [] }, options)).toEqual([]);
    expect(parseWordPressPosts(null, options)).toEqual([]);
  });
});

describe('the blog is the source, not the merchant', () => {
  it('files a post under the retailer it writes about', () => {
    // Otherwise "Costco West Fan Blog" appears as the store on a card about a
    // Costco sale, and the merchant page for that blog fills with other
    // retailers' deals.
    const deals = parseWordPressPosts(POSTS, {
      ...options,
      subjectDomain: 'costco.ca',
      subjectName: 'Costco Canada',
    });

    expect(deals[0]?.merchantDomain).toBe('costco.ca');
    expect(deals[0]?.merchantName).toBe('Costco Canada');
  });

  it('falls back to the blog itself when it covers many retailers', () => {
    const deals = parseWordPressPosts(POSTS, options);
    expect(deals[0]?.merchantDomain).toBe('cocowest.ca');
  });
});

describe('price extraction', () => {
  it('needs two distinct prices', () => {
    expect(extractPrices('now $9.99')).toBeNull();
    expect(extractPrices('no prices here')).toBeNull();
    expect(extractPrices('was $19.99 now $9.99')).toEqual({ now: 9.99, was: 19.99 });
  });

  it('refuses a pair that is not a discount', () => {
    expect(extractPrices('$10.00 and $10.00')).toBeNull();
  });
});

describe('images', () => {
  it('prefers the embedded featured image', () => {
    expect(featuredImage(POSTS[0] as never)).toBe('https://www.cocowest.ca/img.jpg');
  });

  it('falls back to the first inline image, because a card with none is worse', () => {
    expect(featuredImage(POSTS[2] as never)).toBe('https://www.smartcanucks.ca/inline.jpg');
  });

  it('returns null when there is no image at all', () => {
    expect(featuredImage(POSTS[1] as never)).toBeNull();
  });
});

describe('the posts URL', () => {
  it('asks WordPress to embed the featured image, saving a request per post', () => {
    const url = buildPostsUrl('https://www.cocowest.ca/', 20);

    expect(url).toBe('https://www.cocowest.ca/wp-json/wp/v2/posts?per_page=20&_embed=1');
  });
});

describe('the adapter', () => {
  it('maps a response through the engine', async () => {
    const result = await createWordPressAdapter(config()).fetch({
      http: { fetchJson: vi.fn(async () => ({ data: POSTS })), fetchText: vi.fn() },
      log: vi.fn(),
      limit: 10,
    } as never);

    expect(result.deals.length).toBeGreaterThan(0);
    expect(result.path).toBe('wp-json');
  });

  it('says plainly that RSS is no fallback here', async () => {
    // RSS carries neither prices nor images, which are the two things this
    // engine needs — so there is nothing useful to degrade to.
    const result = await createWordPressAdapter(config()).fetch({
      http: {
        fetchJson: vi.fn(async () => {
          throw new Error('HTTP 404');
        }),
        fetchText: vi.fn(),
      },
      log: vi.fn(),
    } as never);

    expect(result.deals).toEqual([]);
    expect(result.reason).toContain('RSS carries no prices');
  });

  it('is skipped when the catalogue disables it', () => {
    expect(createWordPressAdapter(config({ enabled: false })).enabled()).toMatchObject({
      enabled: false,
    });
  });
});
