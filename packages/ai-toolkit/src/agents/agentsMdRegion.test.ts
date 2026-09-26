import { describe, expect, it } from 'vitest'
import { agentsMd, renderManagedBlock } from './agentsMd.js'
import {
  AGENTS_MANAGED_VERSION,
  agentsMdStatus,
  freeRegionScaffold,
  parseAgentsIdentity,
  readManagedVersion,
  swapManagedBlock,
  wrapManaged,
} from './agentsMdRegion.js'

/**
 * 이 모듈은 소비자의 AGENTS.md를 **덮어쓴다**. 자유 영역 보존이 틀리면 사용자가 쓴 내용이
 * 사라지고 되돌릴 수 없다 — 릴리즈 전 손 검증(새 스캐폴드로 init 1회)은 "기존 파일을 갱신하는"
 * 이 경로를 태우지 않으므로 여기서 덮는다.
 */

/** 마커 토큰은 계약이다(안내 문구가 바뀌어도 토큰만 보고 찾는다) → 리터럴로 고정해 둔다. */
const START_TOKEN = `<!-- BSTAGE:MANAGED:START v=${AGENTS_MANAGED_VERSION} -->`
const END_TOKEN = '<!-- BSTAGE:MANAGED:END -->'

describe('readManagedVersion', () => {
  it('마커가 없으면 null (마커 도입 전 레거시 파일)', () => {
    expect(readManagedVersion('# AGENTS.md\n\n아무 마커도 없다.')).toBeNull()
  })

  it('마커에 v=가 없으면 0', () => {
    expect(readManagedVersion('<!-- BSTAGE:MANAGED:START — 안내 문구 -->\n본문')).toBe(0)
  })

  it('v=N을 숫자로 읽는다', () => {
    expect(readManagedVersion('<!-- BSTAGE:MANAGED:START v=3 -->')).toBe(3)
  })

  it('안내 문구가 길어도 토큰만 보고 찾는다', () => {
    expect(readManagedVersion(wrapManaged('본문'))).toBe(AGENTS_MANAGED_VERSION)
  })
})

describe('마커 찾기 — 코멘트 경계와 최악 입력', () => {
  it('토큰이 코멘트 안에 인용만 돼 있으면 마커가 아니다', () => {
    const quoted = '<!-- 참고: BSTAGE:MANAGED:START 토큰은 SDK가 관리합니다 -->\n본문'
    expect(readManagedVersion(quoted)).toBeNull()
  })

  it('앞 코멘트가 마커가 아니어도 뒤 코멘트에서 찾는다', () => {
    const content = `<!-- 사람이 쓴 메모 -->\n<!-- BSTAGE:MANAGED:START v=7 -->\n본문`
    expect(readManagedVersion(content)).toBe(7)
  })

  it('코멘트가 닫히지 않았으면 마커로 보지 않는다', () => {
    expect(readManagedVersion('<!-- BSTAGE:MANAGED:START v=7 \n본문')).toBeNull()
  })

  it('앞에 닫히지 않은 코멘트가 있어도 뒤의 마커를 찾는다', () => {
    const content = '<!-- 쓰다 만 메모\n<!-- BSTAGE:MANAGED:START v=5 -->\n본문'
    expect(readManagedVersion(content)).toBe(5)
  })

  it('여는 괄호가 아주 많아도 선형 시간에 끝난다', () => {
    const many = `${'<!--'.repeat(50_000)}${'x'.repeat(200_000)}-->`
    const t0 = Date.now()
    expect(readManagedVersion(many)).toBeNull()
    expect(Date.now() - t0).toBeLessThan(500)
  })

  it('v= 앞에 공백이 없으면 버전으로 읽지 않는다 (0)', () => {
    expect(readManagedVersion('<!-- BSTAGE:MANAGED:STARTv=3 -->')).toBe(0)
  })

  /**
   * 옛 구현은 마커를 정규식 하나(`[\s\S]*?-->` + `\d+`)로 찾아서, 닫히지 않은 코멘트의
   * 숫자 길이에 **제곱**으로 느려졌다(20만 자에 3.7초 — 코드 스캔이 polynomial ReDoS로 지적).
   * 이 파일은 사용자의 AGENTS.md이므로 길이도 내용도 SDK가 정하지 않는다.
   */
  it('닫히지 않은 코멘트에 숫자가 길게 이어져도 선형 시간에 끝난다', () => {
    const pathological = `<!-- ${'BSTAGE:MANAGED:START'} v=${'9'.repeat(200_000)}`
    const t0 = Date.now()
    expect(readManagedVersion(pathological)).toBeNull()
    expect(Date.now() - t0).toBeLessThan(500)
  })
})

describe('agentsMdStatus', () => {
  it('마커 없음 → legacy', () => {
    expect(agentsMdStatus('# AGENTS.md')).toBe('legacy')
  })

  it('관리 영역 버전이 낮으면 → stale', () => {
    expect(agentsMdStatus(`<!-- BSTAGE:MANAGED:START v=${AGENTS_MANAGED_VERSION - 1} -->`)).toBe(
      'stale',
    )
  })

  it('v= 없는 마커(=0)도 stale', () => {
    expect(agentsMdStatus('<!-- BSTAGE:MANAGED:START -->')).toBe('stale')
  })

  it('현재 버전 → ok', () => {
    expect(agentsMdStatus(wrapManaged('본문'))).toBe('ok')
  })
})

describe('swapManagedBlock — 자유 영역 보존', () => {
  it('START~END 바깥의 사용자 내용을 앞뒤로 모두 보존한다', () => {
    const existing = [
      '# 우리 프로젝트 AGENTS.md',
      '',
      wrapManaged('구버전 관리 영역 본문'),
      '',
      '## 내가 직접 쓴 규칙',
      '이 문장은 절대 사라지면 안 된다.',
      '',
    ].join('\n')

    const result = swapManagedBlock(existing, wrapManaged('새 관리 영역 본문'))

    expect(result).not.toBeNull()
    expect(result).toContain('# 우리 프로젝트 AGENTS.md')
    expect(result).toContain('이 문장은 절대 사라지면 안 된다.')
    expect(result).toContain('새 관리 영역 본문')
    expect(result).not.toContain('구버전 관리 영역 본문')
  })

  it('치환 결과가 다시 ok 상태로 판정된다 (skills install 왕복)', () => {
    const stale = `${START_TOKEN}\n옛 본문\n${END_TOKEN}\n\n## 자유 영역\n내 메모\n`
    expect(agentsMdStatus(stale)).toBe('ok') // START_TOKEN이 현재 버전이므로

    const swapped = swapManagedBlock(stale, wrapManaged('새 본문'))
    expect(swapped).not.toBeNull()
    expect(agentsMdStatus(swapped as string)).toBe('ok')
    expect(swapped).toContain('내 메모')

    // 마커가 정확히 한 쌍만 남아야 한다. 옛 END를 안 걷어내면 마커가 겹쳐 다음 갱신이
    // 엉뚱한 구간을 덮어쓴다 — 상태 판정(ok)만으로는 드러나지 않는 종류의 손상이다.
    expect((swapped as string).match(/BSTAGE:MANAGED:START/g)).toHaveLength(1)
    expect((swapped as string).match(/BSTAGE:MANAGED:END/g)).toHaveLength(1)
  })

  it('init 산출물(관리 영역 + 자유 영역 스캐폴드)을 갱신해도 자유 영역이 남는다', () => {
    const opts = {
      space: 'my-space',
      projectName: 'my-space-custom-templates-dev',
      target: 'user',
    } as const
    const withUserNote = `${agentsMd(opts)}\n- 우리 팀 규칙: PR은 2명 리뷰\n`

    const result = swapManagedBlock(withUserNote, renderManagedBlock({ ...opts, space: 'other' }))

    expect(result).not.toBeNull()
    expect(result).toContain('우리 팀 규칙: PR은 2명 리뷰')
    expect(result).toContain(freeRegionScaffold().split('\n')[0])
    expect(result).toContain('**Space**: other')
    expect(result).not.toContain('**Space**: my-space\n')
  })

  it('마커가 없으면 null (호출부가 reconcile 경로로 분기)', () => {
    expect(swapManagedBlock('# 마커 없는 레거시 파일', wrapManaged('새 본문'))).toBeNull()
  })

  it('END 마커만 없으면 null', () => {
    expect(swapManagedBlock(`${START_TOKEN}\n본문만 있고 END가 없다`, wrapManaged('새'))).toBeNull()
  })

  it('END가 START보다 앞에 있으면 null (잘못된 순서로 덮어쓰지 않는다)', () => {
    const inverted = `${END_TOKEN}\n본문\n${START_TOKEN}`
    expect(swapManagedBlock(inverted, wrapManaged('새 본문'))).toBeNull()
  })
})

describe('parseAgentsIdentity', () => {
  it('관리 영역에서 space·projectName을 읽는다', () => {
    const content = agentsMd({
      space: 'my-space',
      projectName: 'my-space-custom-templates-dev-4',
    })
    expect(parseAgentsIdentity(content)).toEqual({
      space: 'my-space',
      projectName: 'my-space-custom-templates-dev-4',
    })
  })

  it('없으면 undefined (호출부가 레포명 규칙으로 fallback)', () => {
    expect(parseAgentsIdentity('# AGENTS.md\n내용 없음')).toEqual({
      space: undefined,
      projectName: undefined,
    })
  })
})
