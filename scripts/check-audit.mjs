#!/usr/bin/env node
// 의존성 취약점 게이트 — 런타임 의존(직접·간접 모두)에 high/critical 권고가 있으면 PR 을 막는다.
// (AWS Security Agent 21·22차: 새 런타임 의존성이 CVE 를 달고 들어와도 알아챌 단계가 없었다.)
//
// BASELINE: 이 게이트를 들이기 전부터 main 에 있던 권고 — 모두 packages/cli 의 vite@7.3.1 · @vitejs/plugin-react@5.2.0 아래.
// 항목마다 권고 id·패키지·설치 버전·허용 경로(via)·만료일·사유·조치 계획·승인 근거를 둔다. 한 finding 은
//   id·패키지·버전이 같고, 그 finding 의 **모든** 경로가 via 중 하나와 같거나 그 아래(" > " 로 이어짐)일 때만 기준선으로 본다.
// 그래서 같은 패키지가 다른 경로(예: 새 직접 의존 `packages/cli > nanoid@3.3.11`)로 들어오면 다시 막힌다.
// 만료일이 지난 항목은 감사 결과와 상관없이 실패한다. 새 권고는 여기 넣지 말고 버전을 올린다.
import { spawnSync } from 'node:child_process'

const VITE = 'packages/cli > vite@7.3.1'
const PLUGIN_VITE = 'packages/cli > @vitejs/plugin-react@5.2.0 > vite@7.3.1'
const PLUGIN = 'packages/cli > @vitejs/plugin-react@5.2.0'
const COMMON = {
  expires: '2027-01-31',
  reason: '게이트 도입 전부터 있던 dev 서버(vite) 계열 권고 — 이 PR 이 바꾸지 않은 의존',
  remediation:
    'vite >=7.3.7 · @vitejs/plugin-react 최신으로 업그레이드(별도 작업, dev 서버 동작 검토)',
  approval: '내장 저장소 명령 PR(#454) 보안 리뷰 스레드에서 기한부 수용',
}
const viteEntry = (id) => ({
  ...COMMON,
  id,
  module: 'vite',
  version: '7.3.1',
  via: [VITE, PLUGIN_VITE],
  exact: true,
})
const underVite = (id, module, version) => ({
  ...COMMON,
  id,
  module,
  version,
  via: [VITE, PLUGIN_VITE],
})
const underPlugin = (id, module, version) => ({ ...COMMON, id, module, version, via: [PLUGIN] })
const BASELINE = [
  viteEntry('GHSA-587h-7wmj-h5pm'),
  viteEntry('GHSA-p9ff-h696-f583'),
  viteEntry('GHSA-v2wj-q39q-566r'),
  underVite('GHSA-mw96-cpmx-2vgc', 'rollup', '4.57.1'),
  underVite('GHSA-c2c7-rcm5-vvqj', 'picomatch', '4.0.3'),
  underVite('GHSA-6g55-p6wh-862q', 'postcss', '8.5.6'),
  underVite('GHSA-r28c-9q8g-f849', 'postcss', '8.5.6'),
  underVite('GHSA-28wg-ghj8-5hjv', 'nanoid', '3.3.11'),
  underVite('GHSA-2v37-7h3g-55p8', 'nanoid', '3.3.11'),
  underVite('GHSA-xwg4-73v4-xw9w', 'nanoid', '3.3.11'),
  underVite('GHSA-68fv-2mgg-jv7q', 'source-map-js', '1.2.1'),
  underPlugin('GHSA-73wf-gq98-2v4g', 'browserslist', '4.28.1'),
  underPlugin('GHSA-c83g-rgw3-j3cx', 'browserslist', '4.28.1'),
]
const BLOCKING = new Set(['high', 'critical'])

const today = new Date().toISOString().slice(0, 10)
const expired = BASELINE.filter((b) => b.expires < today)
if (expired.length > 0) {
  console.error(
    '기준선 만료 — 업그레이드하거나 검토 후 기한을 다시 정하세요:\n  ' +
      expired
        .map((b) => `${b.id} ${b.module}@${b.version} (만료 ${b.expires}; ${b.remediation})`)
        .join('\n  '),
  )
  process.exit(1)
}

const r = spawnSync('pnpm', ['audit', '--prod', '--json'], {
  encoding: 'utf-8',
  maxBuffer: 64 << 20,
})
let report
try {
  report = JSON.parse(r.stdout)
} catch {
  // 감사 서버에 닿지 못하면 통과시키지 않는다(fail-closed).
  console.error('pnpm audit 결과를 읽지 못했습니다:\n' + (r.stderr || r.stdout).slice(0, 2000))
  process.exit(1)
}
if (report.error) {
  console.error('pnpm audit 오류: ' + JSON.stringify(report.error).slice(0, 2000))
  process.exit(1)
}

const norm = (p) => p.split(/\s*>\s*/).join(' > ')
const within = (path, b) =>
  b.via.some((v) => path === v || (!b.exact && path.startsWith(`${v} > `)))
const baselineFor = (a, f, paths) =>
  BASELINE.find(
    (b) =>
      b.id === a.github_advisory_id &&
      b.module === a.module_name &&
      b.version === f.version &&
      paths.length > 0 &&
      paths.every((p) => within(p, b)),
  )

const blocked = []
const warned = []
for (const a of Object.values(report.advisories ?? {})) {
  if (!BLOCKING.has(a.severity)) continue
  for (const f of a.findings ?? []) {
    const line = `${a.severity.toUpperCase()} ${a.github_advisory_id} ${a.module_name}@${f.version} → ${a.patched_versions}`
    const paths = (f.paths ?? []).map(norm)
    const b = baselineFor(a, f, paths)
    if (b) warned.push(`${line} (기준선, ${b.expires} 까지 — ${b.remediation})`)
    else blocked.push(`${line}\n    ${paths.join('\n    ')}`)
  }
}

if (warned.length > 0) {
  console.log(`경고 — 기준선 권고 ${warned.length}건:\n  ${warned.join('\n  ')}`)
}
if (blocked.length > 0) {
  console.error(
    `런타임 의존에 high/critical 권고 ${blocked.length}건 — 패치 버전으로 올리세요:\n  ${blocked.join('\n  ')}`,
  )
  process.exit(1)
}
console.log('기준선 밖 high/critical 권고 없음')
