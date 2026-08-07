export interface ReportManifest {
  executionId: string;
  projectName: string;
  appUrl: string;
  status: string;
  scores: {
    functional?: number;
    accessibility?: number;
    performance?: number;
    security?: number;
    uiux?: number;
  };
  summary: { passed: number; failed: number; total: number };
  findings: Array<{
    category: string;
    severity: string;
    title: string;
    description: string;
    recommendation?: string;
  }>;
  testCases: Array<Record<string, unknown>>;
  recommendations: string[];
}
