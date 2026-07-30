# Conduit dashboard

React + TypeScript + Vite client for the Conduit load-testing stack. It starts tests against
the Go load tester and renders the resulting metric stream live: latency and throughput
charts, the most recent request/response packet, an event timeline, and retained per-test
final summaries with SVG/JSON export.

Expects the Go load tester on `http://localhost:8081` — see the [root README](../README.md)
for the full stack and quick start.

```bash
npm install
npm run dev       # dev server on :5173
npm run build     # type-check + production build
npm run preview   # serve the production build
npm run lint      # ESLint
```

Source layout: `src/components/` (presentational), `src/hooks/useMetricsStream.ts` (owns the
WebSocket only), `src/state/` (frame validation and reducers), `src/export/` (standalone SVG
and JSON generation), `src/types/metrics.ts` (mirrors the Go wire contract).
