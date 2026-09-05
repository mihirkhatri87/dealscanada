import { describe, expect, it } from 'vitest';
import { RobotsTxt } from '@/lib/util/robots';

const UA = 'DealsCanadaBot/0.1';

describe('RobotsTxt', () => {
  it('allows everything when there are no rules', () => {
    expect(RobotsTxt.allowAll().isAllowed('/anything', UA)).toBe(true);
    expect(RobotsTxt.parse('').isAllowed('/anything', UA)).toBe(true);
  });

  it('honours a wildcard Disallow', () => {
    const robots = RobotsTxt.parse('User-agent: *\nDisallow: /checkout');
    expect(robots.isAllowed('/checkout/cart', UA)).toBe(false);
    expect(robots.isAllowed('/products/tv', UA)).toBe(true);
  });

  it('treats an empty Disallow as permission', () => {
    const robots = RobotsTxt.parse('User-agent: *\nDisallow:');
    expect(robots.isAllowed('/anything', UA)).toBe(true);
  });

  it('lets a longer Allow override a shorter Disallow', () => {
    const robots = RobotsTxt.parse(
      'User-agent: *\nDisallow: /products\nAllow: /products/sale',
    );
    expect(robots.isAllowed('/products/tv', UA)).toBe(false);
    expect(robots.isAllowed('/products/sale/tv', UA)).toBe(true);
  });

  it('prefers Allow when two rules are equally specific', () => {
    const robots = RobotsTxt.parse('User-agent: *\nDisallow: /x\nAllow: /x');
    expect(robots.isAllowed('/x/y', UA)).toBe(true);
  });

  it('supports wildcards and end-anchors in paths', () => {
    const robots = RobotsTxt.parse('User-agent: *\nDisallow: /*.pdf$\nDisallow: /a/*/b');
    expect(robots.isAllowed('/manual.pdf', UA)).toBe(false);
    expect(robots.isAllowed('/manual.pdf?v=1', UA)).toBe(true);
    expect(robots.isAllowed('/a/anything/b', UA)).toBe(false);
    expect(robots.isAllowed('/a/anything/c', UA)).toBe(true);
  });

  it('prefers a group naming our agent over the wildcard group', () => {
    const robots = RobotsTxt.parse(
      'User-agent: *\nDisallow: /\n\nUser-agent: dealscanadabot\nDisallow: /private',
    );
    expect(robots.isAllowed('/products', UA)).toBe(true);
    expect(robots.isAllowed('/private/x', UA)).toBe(false);
  });

  it('groups consecutive User-agent lines together', () => {
    const robots = RobotsTxt.parse(
      'User-agent: googlebot\nUser-agent: dealscanadabot\nDisallow: /shared',
    );
    expect(robots.isAllowed('/shared/x', UA)).toBe(false);
  });

  it('ignores comments and malformed lines', () => {
    const robots = RobotsTxt.parse(
      '# a comment\nUser-agent: *\nthis line is nonsense\nDisallow: /x # trailing',
    );
    expect(robots.isAllowed('/x', UA)).toBe(false);
    expect(robots.isAllowed('/y', UA)).toBe(true);
  });

  it('does not throw on garbage input', () => {
    expect(() => RobotsTxt.parse('  nonsense ]]][[[')).not.toThrow();
  });
});
