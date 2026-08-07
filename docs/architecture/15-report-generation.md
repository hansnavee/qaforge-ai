# Report Generation Architecture — QAForge AI

## Pipeline

1. Agents write structured findings to Postgres + R2
2. Report Agent aggregates into `report-manifest.json`
3. Report engine renders:
   - Interactive HTML dashboard
   - PDF executive summary
   - CSV / XLSX results and test cases
   - JUnit XML
   - JSON dump
4. ZIP assembler packs framework + media + reports
5. Signed download URLs with TTL

## HTML report sections

Executive dashboard, pass/fail, coverage, functional / UX / API / a11y / perf / security, product improvements, screenshots, videos, AI recommendations, downloads.
