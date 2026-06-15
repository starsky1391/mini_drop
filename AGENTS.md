<!-- SPECKIT START -->
For additional context about technologies to be used, project structure,
shell commands, and other important information, read the current plan
<!-- SPECKIT END -->

## Agent Context: Collector Maturity Alignment (002-collector-maturity)

This round focuses on reducing collector maturity asymmetry and making deferred Linux proof explicit rather than pretending it is already complete.

### Collector Maturity States

| State | Label | Description |
|-------|-------|-------------|
| `preferred` | 首选真实链路 | 当前平台与依赖满足条件，可优先走真实采集路径 |
| `partial-real` | 部分真实链路 | 可以保留部分真实采样证据，但存在平台、权限或解析层面的降级 |
| `fallback-only` | 仅 fallback | 当前环境无法走首选真实链路，只能使用 managed workload 或 synthetic fallback |
| `deferred-for-linux-proof` | Linux 现场证明延期 | 该采集器需要 Linux 环境才能完成真实链路现场证明，当前平台暂不具备条件 |

### Current Collector Maturity (Windows Host)

| Collector | Maturity | Readiness |
|-----------|----------|-----------|
| py-spy | stable | preferred |
| async-profiler | partial | fallback-only (Windows) |
| perf | deferred | deferred-for-linux-proof |
| eBPF | deferred | deferred-for-linux-proof |

### Key Files

- `shared/types.ts` - `CollectorReadinessStatus` includes `deferred-for-linux-proof`
- `shared/catalog.ts` - Collector maturity annotations (`expectedMaturityOnCurrentHost`, `maturityNote`, `maturityNoteZh`)
- `server/agent/probe.ts` - Platform-aware probe logic for perf/eBPF
- `server/notes.ts` - `collectorMaturityMatrix` with platform-aware data
- `src/App.tsx` - UI readiness cards with maturity notes
- `specs/002-collector-maturity/quickstart.md` - Full maturity matrix and validation guide

### Validation

```bash
npm run typecheck
npm run test
npm run build
npm run validate:offline-agent
```
