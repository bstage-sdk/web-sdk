import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * 마이그레이션 항목이 요구하는 (패키지, 최소 버전) 쌍. 헤더 `## → cli 0.43.0`에서 파싱.
 * @internal 파서 테스트용으로 노출. public API 아님.
 */
export interface MigrationRequirement {
  /** 정규화된 패키지 이름(예: `@bstage-sdk/cli`). */
  pkg: string
  /** 이 버전 이상이면 항목이 이미 적용된 상태다(설치본이 더 낮으면 적용 대상). */
  version: string
}

/** @internal 파서 테스트용으로 노출. public API 아님. */
export interface MigrationEntry {
  /** 헤더 원문 표기(예: `cli 0.43.0`, `core 0.32.0 · react 0.32.0 · cli 0.32.0`). 리포트·JSON 표시용. */
  label: string
  /** 이 항목이 딸린 패키지·버전 요구. 하나라도 미충족(설치본이 더 낮음)이면 적용 대상. */
  requirements: MigrationRequirement[]
  items: string[]
}

/** 항목이 요구하는 패키지의 설치 상태. `relevant`가 false면 이 소비자와 무관한 항목이다. */
export type MigrationResolver = (pkg: string) => Promise<{
  version: string | null
  relevant: boolean
}>

/**
 * CLI에 동봉된 MIGRATION.md에서 소비자가 아직 적용하지 않은 섹션을 추출한다.
 * 섹션 헤더는 `## → {패키지} {버전}`(예: `## → cli 0.43.0`, `## → core 0.32.0 · react 0.32.0`),
 * 레거시 `## → x.y.z` / `## x.y.z`(패키지명 없음)는 core 기준으로 해석한다. 하위 항목은 `### 제목` 형식.
 *
 * 패키지가 완전 독립 버전이므로 core 하나로 통일 비교할 수 없다. 항목이 명시한 패키지의
 * 설치 버전을 각각 대조해, **관련 있고(설치·선언됨) 설치본이 요구 버전보다 낮은** 패키지가
 * 하나라도 있으면 적용 대상으로 본다. 관련 없는 패키지만 있는 항목은 숨긴다.
 *
 * 가이드는 **실행 중인 CLI 버전과 함께** 동봉된다(build 시 repo docs/MIGRATION.md 복사).
 * 오래된 프로젝트의 node_modules에는 최신 가이드가 없으므로, 의도적으로 CLI 쪽을 읽는다.
 * 따라서 `npx @bstage-sdk/cli@latest doctor`가 항상 최신 가이드로 진단한다.
 */
export async function readApplicableMigrations(
  resolve: MigrationResolver,
): Promise<MigrationEntry[]> {
  const md = await readBundledMigrationDoc()
  if (md === null) return []
  return selectApplicableMigrations(parseMigrationDoc(md), resolve)
}

/**
 * MIGRATION.md 본문을 항목 목록으로 파싱한다.
 *
 * @internal 디스크 접근과 분리해 테스트할 수 있게 노출. public API 아님.
 */
export function parseMigrationDoc(md: string): MigrationEntry[] {
  const lines = md.split('\n')
  // `## → ...` 또는 `## x.y.z`. 버전이 없는 `##`(산문 섹션 헤더)은 마이그레이션 항목으로 치지 않는다.
  const sectionRe = /^##\s+(?:→\s*)?(.+?)\s*$/
  const itemRe = /^###\s+(.+?)\s*$/

  const entries: MigrationEntry[] = []
  let current: MigrationEntry | null = null
  for (const line of lines) {
    const sec = sectionRe.exec(line)
    if (sec) {
      const requirements = parseMigrationRequirements(sec[1])
      // 버전 요구가 없으면 산문 섹션이므로 항목 수집을 멈춘다(current=null).
      current = requirements.length > 0 ? { label: sec[1].trim(), requirements, items: [] } : null
      if (current) entries.push(current)
      continue
    }
    if (current) {
      const item = itemRe.exec(line)
      if (item) {
        // 배지(`— 판단 · 선택`)는 제목에서 떼어 깔끔하게 표시
        current.items.push(item[1].replace(/\s*[—–-]\s*`.*$/, '').trim())
      }
    }
  }
  return entries
}

/**
 * 파싱된 항목 중 이 소비자에게 아직 적용되지 않은 것만 고른다.
 *
 * @internal 테스트용으로 노출. public API 아님.
 */
export async function selectApplicableMigrations(
  entries: MigrationEntry[],
  resolve: MigrationResolver,
): Promise<MigrationEntry[]> {
  const applicable: MigrationEntry[] = []
  for (const e of entries) {
    let applies = false
    for (const req of e.requirements) {
      const { version, relevant } = await resolve(req.pkg)
      if (!relevant) continue
      // 관련 있으나 버전 미상(workspace:* 등)이면 보수적으로 노출. 설치본이 더 낮아도 적용 대상.
      if (version === null || compareSemver(version, req.version) < 0) {
        applies = true
        break
      }
    }
    if (applies) applicable.push(e)
  }
  return applicable
}

/**
 * 섹션 헤더 텍스트에서 (패키지, 버전) 요구를 뽑는다.
 * `cli 0.43.0` → `{cli, 0.43.0}`, `core 0.32.0 · react 0.32.0` → 둘, 레거시 `0.44.0`(패키지명 없음) → core 기준.
 *
 * @internal 테스트용으로 노출. public API 아님.
 */
export function parseMigrationRequirements(text: string): MigrationRequirement[] {
  const reqs: MigrationRequirement[] = []
  const re = /(?:([a-z][a-z-]*)\s+)?(\d+\.\d+\.\d+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    reqs.push({ pkg: normalizeMigrationPkg(m[1]), version: m[2] })
  }
  return reqs
}

/**
 * 헤더의 짧은 패키지명(`cli`·`design`)을 정식 이름으로. 이름이 없으면(레거시) core 기준.
 * @internal 테스트용으로 노출. public API 아님.
 */
export function normalizeMigrationPkg(short: string | undefined): string {
  if (!short) return '@bstage-sdk/core'
  return short.startsWith('@') ? short : `@bstage-sdk/${short}`
}

/**
 * 동봉된 MIGRATION.md를 읽는다. 배포물에서는 CLI dist/ 옆에 복사되어 있고,
 * 소스 실행(dev) 시엔 repo의 docs/MIGRATION.md로 fallback한다. 못 찾으면 null.
 */
async function readBundledMigrationDoc(): Promise<string | null> {
  const here = dirname(fileURLToPath(import.meta.url))
  const candidates = [
    join(here, 'MIGRATION.md'), // 배포물: dist/ 옆 (cli/dist/MIGRATION.md)
    join(here, '..', '..', '..', 'docs', 'MIGRATION.md'), // dev(dist): cli/dist → repo/docs
    // dev(src): cli/src/commands/doctor → repo/docs (모듈 분리로 한 단계 깊어졌다)
    join(here, '..', '..', '..', '..', '..', 'docs', 'MIGRATION.md'),
  ]
  for (const path of candidates) {
    try {
      return await readFile(path, 'utf-8')
    } catch {
      // 다음 후보
    }
  }
  return null
}

/**
 * `^1.2.3` / `~1.2.3` / `1.2.3` → `1.2.3`. 범위/태그면 null.
 * @internal 테스트용으로 노출. public API 아님.
 */
export function cleanRange(spec: string | undefined): string | null {
  if (!spec) return null
  const m = /(\d+\.\d+\.\d+)/.exec(spec)
  return m ? m[1] : null
}

/**
 * semver 비교. a<b → -1, a==b → 0, a>b → 1. prerelease는 무시(메이저/마이너/패치만).
 * @internal 테스트용으로 노출. public API 아님.
 */
export function compareSemver(a: string, b: string): number {
  const pa = a.split('.').map((n) => parseInt(n, 10))
  const pb = b.split('.').map((n) => parseInt(n, 10))
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] || 0) - (pb[i] || 0)
    if (d !== 0) return d < 0 ? -1 : 1
  }
  return 0
}
