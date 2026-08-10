import type { AgentHandler } from '@qaforge/agent-sdk';
import { ArtifactType } from '@qaforge/shared';
import { putBinaryArtifact } from '../context.js';

type GithubActionsInput = {
  projectName: string;
  appUrl: string;
};

export const githubActionsAgent: AgentHandler<GithubActionsInput, unknown> = {
  id: 'GITHUB_ACTIONS',
  name: 'GitHub Actions Agent',

  async run(ctx, input) {
    const workflow = `name: QAForge STLC

on:
  workflow_dispatch:
  push:
    branches: [main, master]

jobs:
  stlc-smoke:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
      - name: Install Playwright project
        working-directory: automation
        run: |
          npm ci || npm install
          npx playwright install --with-deps chromium
      - name: Run automation
        working-directory: automation
        env:
          BASE_URL: ${input.appUrl}
        run: npx playwright test
      - name: Upload Playwright report
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: playwright-report
          path: automation/playwright-report

  # Optional: after deploy, start STLC Cycle N+1 (reuses Design/Env/Data).
  # Requires a session cookie or future project deploy token.
  # start-next-stlc-cycle:
  #   needs: [deploy] # wire to your deploy job
  #   runs-on: ubuntu-latest
  #   steps:
  #     - name: Start next STLC cycle
  #       env:
  #         QAFORGE_API_URL: https://api.example.com
  #         QAFORGE_ORG_ID: \${{ secrets.QAFORGE_ORG_ID }}
  #         QAFORGE_PROJECT_ID: \${{ secrets.QAFORGE_PROJECT_ID }}
  #         QAFORGE_SESSION_COOKIE: \${{ secrets.QAFORGE_SESSION_COOKIE }}
  #       run: |
  #         curl -fsS -X POST \\
  #           -H "Cookie: qf_session=\$QAFORGE_SESSION_COOKIE" \\
  #           -H "Content-Type: application/json" \\
  #           "\$QAFORGE_API_URL/api/v1/orgs/\$QAFORGE_ORG_ID/projects/\$QAFORGE_PROJECT_ID/stlc/cycles"
`;

    await putBinaryArtifact({
      executionId: ctx.executionId,
      type: ArtifactType.GITHUB_ACTIONS_WORKFLOW,
      key: `${ctx.executionId}/github/.github/workflows/qaforge-stlc.yml`,
      body: Buffer.from(workflow, 'utf8'),
      mime: 'text/yaml',
      store: ctx.artifactStore,
    });

    await ctx.emit({
      type: 'github_actions.ready',
      phase: 'GITHUB',
      message: `GitHub Actions workflow drafted for ${input.projectName}`,
    });

    return { workflowPath: '.github/workflows/qaforge-stlc.yml' };
  },
};
