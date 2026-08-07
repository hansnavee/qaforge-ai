import type { AgentHandler } from '@qaforge/agent-sdk';
import { ArtifactType } from '@qaforge/shared';

export const apiAgent: AgentHandler = {
  id: 'API_TESTING',
  name: 'API Agent',

  async run(ctx) {
    const map = await ctx.getArtifactJson<{
      networkRequests?: Array<{
        method: string;
        url: string;
        resourceType: string;
      }>;
    }>(ArtifactType.APPLICATION_MAP);

    const requests = map?.networkRequests ?? [];
    const endpoints = requests.map((r, i) => ({
      id: `API-${String(i + 1).padStart(3, '0')}`,
      method: r.method,
      url: r.url,
      resourceType: r.resourceType,
      checks: [
        'Responds without 5xx under smoke load',
        'Returns JSON/content-type when applicable',
      ],
    }));

    const results = {
      source: 'discovery-network-capture',
      endpointCount: endpoints.length,
      endpoints: endpoints.slice(0, 50),
      findings: endpoints.length
        ? [
            {
              severity: 'info',
              title: 'Captured XHR/fetch endpoints during discovery',
              description: `${endpoints.length} same-origin API-like requests observed.`,
              recommendation:
                'Promote critical endpoints into contract tests with schema assertions.',
            },
          ]
        : [
            {
              severity: 'low',
              title: 'No XHR/fetch captured',
              description:
                'Discovery did not observe API traffic; app may be mostly static or SSR.',
              recommendation: 'Provide OpenAPI or exercise flows that trigger APIs.',
            },
          ],
    };

    await ctx.putArtifactJson(ArtifactType.API_RESULTS, results);
    await ctx.emit({
      type: 'api.ready',
      phase: 'API',
      message: `API map: ${endpoints.length} endpoints`,
      data: { endpointCount: endpoints.length },
    });
    return results;
  },
};
