import type { AgentHandler } from '@qaforge/agent-sdk';
import { ArtifactType } from '@qaforge/shared';

type SecurityInput = {
  appUrl: string;
};

/**
 * Passive security checklist — no offensive scans.
 */
export const securityAgent: AgentHandler<SecurityInput, unknown> = {
  id: 'SECURITY_REVIEW',
  name: 'Security Agent',

  async run(ctx, input) {
    const checks: Array<{
      id: string;
      title: string;
      passed: boolean;
      detail: string;
    }> = [];

    try {
      const res = await fetch(input.appUrl, {
        method: 'GET',
        redirect: 'follow',
      });

      const headers = res.headers;
      const csp = headers.get('content-security-policy');
      const hsts = headers.get('strict-transport-security');
      const xfo = headers.get('x-frame-options');
      const xcto = headers.get('x-content-type-options');
      const referrer = headers.get('referrer-policy');
      const setCookie = headers.getSetCookie?.() ?? [];
      // Fallback for environments without getSetCookie
      const setCookieRaw = headers.get('set-cookie');

      checks.push({
        id: 'csp',
        title: 'Content-Security-Policy',
        passed: Boolean(csp),
        detail: csp ?? 'Missing CSP header',
      });
      checks.push({
        id: 'hsts',
        title: 'Strict-Transport-Security',
        passed: Boolean(hsts),
        detail: hsts ?? 'Missing HSTS header',
      });
      checks.push({
        id: 'x-frame-options',
        title: 'X-Frame-Options',
        passed: Boolean(xfo) || Boolean(csp?.includes('frame-ancestors')),
        detail: xfo ?? 'Missing X-Frame-Options (and no CSP frame-ancestors)',
      });
      checks.push({
        id: 'x-content-type-options',
        title: 'X-Content-Type-Options',
        passed: (xcto ?? '').toLowerCase() === 'nosniff',
        detail: xcto ?? 'Missing nosniff',
      });
      checks.push({
        id: 'referrer-policy',
        title: 'Referrer-Policy',
        passed: Boolean(referrer),
        detail: referrer ?? 'Missing Referrer-Policy',
      });

      const cookies =
        setCookie.length > 0
          ? setCookie
          : setCookieRaw
            ? [setCookieRaw]
            : [];

      if (cookies.length === 0) {
        checks.push({
          id: 'cookies',
          title: 'Set-Cookie flags',
          passed: true,
          detail: 'No Set-Cookie on initial response',
        });
      } else {
        const allSecure = cookies.every((c) => /;\s*Secure/i.test(c));
        const allHttpOnly = cookies.every((c) => /;\s*HttpOnly/i.test(c));
        checks.push({
          id: 'cookie-secure',
          title: 'Cookies Secure flag',
          passed: allSecure,
          detail: allSecure
            ? 'All cookies include Secure'
            : 'One or more cookies missing Secure',
        });
        checks.push({
          id: 'cookie-httponly',
          title: 'Cookies HttpOnly flag',
          passed: allHttpOnly,
          detail: allHttpOnly
            ? 'All cookies include HttpOnly'
            : 'One or more cookies missing HttpOnly',
        });
      }

      checks.push({
        id: 'https',
        title: 'HTTPS transport',
        passed: input.appUrl.startsWith('https://'),
        detail: input.appUrl.startsWith('https://')
          ? 'App URL uses HTTPS'
          : 'App URL is not HTTPS',
      });
    } catch (err) {
      checks.push({
        id: 'fetch',
        title: 'Reachability',
        passed: false,
        detail: err instanceof Error ? err.message : String(err),
      });
    }

    const passed = checks.filter((c) => c.passed).length;
    const score = Math.round((passed / Math.max(checks.length, 1)) * 100);

    const report = {
      score,
      checks,
      note: 'Passive checklist only — no offensive scanning performed.',
    };

    await ctx.putArtifactJson(ArtifactType.SECURITY_CHECKLIST, report);
    await ctx.emit({
      type: 'security.ready',
      phase: 'SECURITY',
      message: `Security checklist score ${score}`,
      data: { score },
    });
    return report;
  },
};
