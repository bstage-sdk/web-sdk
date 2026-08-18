import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import {
  cleanRange,
  compareSemver,
  normalizeMigrationPkg,
  parseMigrationDoc,
  parseMigrationRequirements,
  selectApplicableMigrations,
} from './doctor.js'

/**
 * doctor는 소비자에게 나가는 진단 도구인데, MIGRATION.md 헤더 파싱이 틀리면 항목을 **조용히**
 * 놓친다(에러도 안 난다). 손 검증으로는 "항목이 안 뜨는 게 정상인지 버그인지" 구분할 수 없다.
 */

const PKG = (short: string) => `@bstage-sdk/${short}`

/** 실제 docs/MIGRATION.md의 구조(산문 섹션 + 항목 섹션)를 축약한 픽스처. */
const DOC = `# 마이그레이션 가이드

## 이 문서의 소유권과 역할

### 도구

이 산문 섹션의 ### 는 마이그레이션 항목이 아니다.

## → cli 0.46.0 · design 0.1.1

### \`bstage doctor\`에 권장 의존성 진단 추가 — \`자동\` · \`권장\`

본문

### 어드민 그림자 토큰 예시 정정 — \`자동\` · \`권장\`

## → react 0.39.0

### \`bstage init --target admin\` — 어드민 스캐폴드 + 토큰명 통일 — \`자동\` · \`선택\`

## 0.18.0

### 레거시 헤더(패키지명 없음)는 core 기준
`

describe('parseMigrationDoc', () => {
  const entries = parseMigrationDoc(DOC)

  it('버전이 없는 산문 `##` 섹션은 항목으로 치지 않는다', () => {
    expect(entries.map((e) => e.label)).not.toContain('이 문서의 소유권과 역할')
  })

  it('산문 섹션 아래의 `###`도 수집하지 않는다', () => {
    const collected = entries.flatMap((e) => e.items)
    expect(collected).not.toContain('도구')
    expect(collected.join('\n')).not.toContain('마이그레이션 항목이 아니다')
  })

  it('단일 패키지 헤더를 읽는다', () => {
    const entry = entries.find((e) => e.label === 'react 0.39.0')
    expect(entry?.requirements).toEqual([{ pkg: PKG('react'), version: '0.39.0' }])
  })

  it('`·`로 나열한 다중 패키지 헤더를 모두 읽는다', () => {
    const entry = entries.find((e) => e.label.startsWith('cli 0.46.0'))
    expect(entry?.requirements).toEqual([
      { pkg: PKG('cli'), version: '0.46.0' },
      { pkg: PKG('design'), version: '0.1.1' },
    ])
  })

  it('레거시 헤더(패키지명 없음, 화살표 없음)는 core 기준으로 해석한다', () => {
    const entry = entries.find((e) => e.label === '0.18.0')
    expect(entry?.requirements).toEqual([{ pkg: PKG('core'), version: '0.18.0' }])
  })

  it('항목 제목에서 배지(`— `자동` · `권장``)를 떼어낸다', () => {
    const entry = entries.find((e) => e.label.startsWith('cli 0.46.0'))
    expect(entry?.items).toEqual([
      '`bstage doctor`에 권장 의존성 진단 추가',
      '어드민 그림자 토큰 예시 정정',
    ])
  })

  it('제목 안의 `--flag`와 중간 em-dash는 배지로 오인하지 않는다', () => {
    const entry = entries.find((e) => e.label === 'react 0.39.0')
    expect(entry?.items).toEqual(['`bstage init --target admin` — 어드민 스캐폴드 + 토큰명 통일'])
  })
})

describe('parseMigrationDoc — 실제 docs/MIGRATION.md', () => {
  // 픽스처만 보면 "문서 쪽 헤더가 바뀌었을 때"를 놓친다. 실제 문서를 태워 항목 수를 대조한다.
  // 항목이 아직 없으면 0개끼리 대조해 통과한다 — 첫 항목이 추가되는 순간부터 실질 검사가 된다.
  it('`## → ` 헤더 개수만큼 항목을 뽑는다', async () => {
    const md = await readFile(new URL('../../../../docs/MIGRATION.md', import.meta.url), 'utf-8')
    const headerCount = md.split('\n').filter((l) => /^##\s+→\s/.test(l)).length
    const entries = parseMigrationDoc(md)

    expect(entries).toHaveLength(headerCount)
    // 모든 항목이 정식 패키지명 요구를 갖는다 (`## → 0.x.y` 레거시가 남아 있으면 core로 잡힌다)
    for (const e of entries) {
      expect(e.requirements.length).toBeGreaterThan(0)
      for (const r of e.requirements) expect(r.pkg).toMatch(/^@bstage-sdk\//)
      expect(e.items.length).toBeGreaterThan(0)
    }
  })
})

describe('selectApplicableMigrations', () => {
  const entry = (pkg: string, version: string) => ({
    label: `${pkg} ${version}`,
    requirements: [{ pkg: PKG(pkg), version }],
    items: ['항목'],
  })

  const resolver =
    (map: Record<string, { version: string | null; relevant: boolean }>) => async (pkg: string) =>
      map[pkg] ?? { version: null, relevant: false }

  it('설치본이 요구 버전보다 낮으면 적용 대상', async () => {
    const got = await selectApplicableMigrations(
      [entry('cli', '0.46.0')],
      resolver({ [PKG('cli')]: { version: '0.45.0', relevant: true } }),
    )
    expect(got).toHaveLength(1)
  })

  it('설치본이 같거나 높으면 제외', async () => {
    const resolve = resolver({ [PKG('cli')]: { version: '0.46.0', relevant: true } })
    expect(await selectApplicableMigrations([entry('cli', '0.46.0')], resolve)).toEqual([])

    const ahead = resolver({ [PKG('cli')]: { version: '0.47.0', relevant: true } })
    expect(await selectApplicableMigrations([entry('cli', '0.46.0')], ahead)).toEqual([])
  })

  it('관련 없는 패키지 항목은 숨긴다 (설치하지 않은 패키지의 항목)', async () => {
    const got = await selectApplicableMigrations(
      [entry('host', '0.5.0')],
      resolver({ [PKG('host')]: { version: null, relevant: false } }),
    )
    expect(got).toEqual([])
  })

  it('관련 있는데 버전 미상(workspace:* 등)이면 보수적으로 노출한다', async () => {
    const got = await selectApplicableMigrations(
      [entry('cli', '0.46.0')],
      resolver({ [PKG('cli')]: { version: null, relevant: true } }),
    )
    expect(got).toHaveLength(1)
  })

  it('요구가 여러 개면 하나만 미충족이어도 적용 대상', async () => {
    const multi = {
      label: 'cli 0.46.0 · design 0.1.1',
      requirements: [
        { pkg: PKG('cli'), version: '0.46.0' },
        { pkg: PKG('design'), version: '0.1.1' },
      ],
      items: ['항목'],
    }
    const got = await selectApplicableMigrations(
      [multi],
      resolver({
        [PKG('cli')]: { version: '0.46.0', relevant: true }, // 충족
        [PKG('design')]: { version: '0.1.0', relevant: true }, // 미충족
      }),
    )
    expect(got).toHaveLength(1)
  })

  it('순서를 유지한다', async () => {
    const resolve = resolver({
      [PKG('cli')]: { version: '0.1.0', relevant: true },
      [PKG('core')]: { version: '0.1.0', relevant: true },
    })
    const got = await selectApplicableMigrations(
      [entry('cli', '0.46.0'), entry('core', '0.40.0')],
      resolve,
    )
    expect(got.map((e) => e.label)).toEqual(['cli 0.46.0', 'core 0.40.0'])
  })
})

describe('parseMigrationRequirements', () => {
  it('패키지명 + 버전', () => {
    expect(parseMigrationRequirements('cli 0.43.0')).toEqual([
      { pkg: PKG('cli'), version: '0.43.0' },
    ])
  })

  it('하이픈이 들어간 패키지명도 읽는다', () => {
    expect(parseMigrationRequirements('host 0.5.0')).toEqual([
      { pkg: PKG('host'), version: '0.5.0' },
    ])
  })

  it('버전이 없으면 빈 배열 (산문 헤더 판정 근거)', () => {
    expect(parseMigrationRequirements('항목 작성 규칙')).toEqual([])
  })
})

describe('normalizeMigrationPkg', () => {
  it('짧은 이름을 정식 이름으로', () => {
    expect(normalizeMigrationPkg('cli')).toBe(PKG('cli'))
    expect(normalizeMigrationPkg('host')).toBe(PKG('host'))
  })

  it('이름이 없으면 core 기준 (레거시 헤더)', () => {
    expect(normalizeMigrationPkg(undefined)).toBe(PKG('core'))
  })

  it('이미 스코프가 붙어 있으면 그대로', () => {
    expect(normalizeMigrationPkg('@scope/pkg')).toBe('@scope/pkg')
  })
})

describe('cleanRange', () => {
  it.each([
    ['^1.2.3', '1.2.3'],
    ['~1.2.3', '1.2.3'],
    ['1.2.3', '1.2.3'],
    ['>=0.40.8', '0.40.8'],
  ])('%s → %s', (spec, expected) => {
    expect(cleanRange(spec)).toBe(expected)
  })

  it.each(['latest', 'workspace:*', ''])('버전을 못 찾으면 null (%s)', (spec) => {
    expect(cleanRange(spec)).toBeNull()
  })

  it('undefined → null', () => {
    expect(cleanRange(undefined)).toBeNull()
  })
})

describe('compareSemver', () => {
  it.each([
    ['0.45.0', '0.46.0', -1],
    ['0.46.0', '0.46.0', 0],
    ['0.47.0', '0.46.0', 1],
    ['0.9.0', '0.10.0', -1], // 문자열 비교였다면 뒤집힌다
    ['1.0.0', '0.99.99', 1],
  ])('%s vs %s → %i', (a, b, expected) => {
    expect(compareSemver(a, b)).toBe(expected)
  })

  it('자리수가 모자라면 0으로 채운다', () => {
    expect(compareSemver('1.2', '1.2.0')).toBe(0)
    expect(compareSemver('1.2', '1.2.1')).toBe(-1)
  })
})
