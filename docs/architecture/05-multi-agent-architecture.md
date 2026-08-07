# Multi-Agent Architecture — QAForge AI

## Principles

- Each capability is an independent agent implementing `AgentHandler`
- Agents communicate via artifact contracts (JSON schemas), not chat
- Orchestrator runs a DAG; parallelize independent agents after discovery
- LLM router via OpenRouter with fast/cheap and reasoning tiers

## Agents

| Agent | Output |
|-------|--------|
| Requirement Analysis | `requirements.json` |
| Authentication | authenticated in-memory browser session |
| Application Discovery | `application-map.json` |
| Functional Testing | functional findings + cases |
| UI/UX Review | UX findings |
| API Testing | API results / collections |
| Accessibility | a11y score + issues |
| Performance | perf metrics + recommendations |
| Security Review | security checklist |
| Product Improvement | prioritized roadmap |
| Test Case Generation | CSV / XLSX / JSON / MD |
| Automation Generation | Playwright (MVP) framework |
| Execution | screenshots, videos, results |
| Failure Analysis | root cause + fixes |
| Report Generation | HTML / PDF / JUnit / ZIP |
| GitHub Integration | repo / branch / PR |
| GitHub Actions | CI workflow |

## AgentContext

`projectId`, `executionId`, `browserSessionId`, artifact URIs, LLM budget, org plan limits.
