/**
 * Minimal robots.txt parser — enough to answer "may this user-agent fetch this path".
 *
 * Handles the directives that actually appear in the wild on retailer sites:
 * User-agent grouping (including `*`), Allow, Disallow, and longest-match
 * precedence. Wildcards (`*`) and end-anchors (`$`) in paths are supported since
 * large retailers use them heavily.
 */

interface Group {
  agents: string[];
  rules: Array<{ allow: boolean; path: string }>;
}

export class RobotsTxt {
  private constructor(private readonly groups: Group[]) {}

  /** A permissive instance, used when robots.txt is missing or unparseable. */
  static allowAll(): RobotsTxt {
    return new RobotsTxt([]);
  }

  static parse(content: string): RobotsTxt {
    const groups: Group[] = [];
    let current: Group | null = null;
    let lastLineWasAgent = false;

    for (const rawLine of content.split('\n')) {
      const line = rawLine.split('#')[0]?.trim() ?? '';
      if (!line) continue;

      const separator = line.indexOf(':');
      if (separator === -1) continue;

      const field = line.slice(0, separator).trim().toLowerCase();
      const value = line.slice(separator + 1).trim();

      if (field === 'user-agent') {
        // Consecutive User-agent lines share one group of rules.
        if (!current || !lastLineWasAgent) {
          current = { agents: [], rules: [] };
          groups.push(current);
        }
        current.agents.push(value.toLowerCase());
        lastLineWasAgent = true;
        continue;
      }

      lastLineWasAgent = false;
      if (!current) continue;

      if (field === 'disallow') {
        // An empty Disallow means "allow everything" and carries no path rule.
        if (value !== '') current.rules.push({ allow: false, path: value });
      } else if (field === 'allow') {
        if (value !== '') current.rules.push({ allow: true, path: value });
      }
    }

    return new RobotsTxt(groups);
  }

  isAllowed(path: string, userAgent: string): boolean {
    const group = this.groupFor(userAgent);
    if (!group) return true;

    let best: { allow: boolean; length: number } | null = null;
    for (const rule of group.rules) {
      if (!matchesPath(path, rule.path)) continue;
      const length = rule.path.length;
      // Longest match wins; Allow beats Disallow at equal specificity.
      if (!best || length > best.length || (length === best.length && rule.allow)) {
        best = { allow: rule.allow, length };
      }
    }
    return best ? best.allow : true;
  }

  /** Most specific matching group: an exact agent match beats the `*` group. */
  private groupFor(userAgent: string): Group | null {
    const agent = userAgent.toLowerCase();
    let wildcard: Group | null = null;

    for (const group of this.groups) {
      for (const candidate of group.agents) {
        if (candidate === '*') {
          wildcard ??= group;
        } else if (agent.includes(candidate)) {
          return group;
        }
      }
    }
    return wildcard;
  }
}

function matchesPath(path: string, pattern: string): boolean {
  const anchored = pattern.endsWith('$');
  const body = anchored ? pattern.slice(0, -1) : pattern;

  if (!body.includes('*')) {
    return anchored ? path === body : path.startsWith(body);
  }

  const escaped = body
    .split('*')
    .map((segment) => segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');
  return new RegExp(`^${escaped}${anchored ? '$' : ''}`).test(path);
}

/** Thrown rather than returned so a disallowed fetch can never be mistaken for empty data. */
export class RobotsDisallowedError extends Error {
  constructor(readonly url: string) {
    super(`robots.txt disallows fetching ${url}`);
    this.name = 'RobotsDisallowedError';
  }
}
