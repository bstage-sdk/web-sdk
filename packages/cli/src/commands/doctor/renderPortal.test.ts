import { describe, expect, it } from 'vitest'
import type { PortalReport } from './portal.js'
import { formatPortal, portalNeedsWork } from './renderPortal.js'

// picocolors가 색을 넣는 환경이어도 문구만 비교한다.
// eslint-disable-next-line no-control-regex
const plain = (lines: string[]) => lines.map((l) => l.replace(/\x1b\[[0-9;]*m/g, ''))

const row = (extra: Partial<PortalReport['placements'][number]> = {}) => ({
  placementId: 'p1',
  path: '/me',
  slotId: '',
  surface: 'USER' as const,
  findings: [],
  ...extra,
})

describe('formatPortal', () => {
  it('배치마다 이름 아래에 심각도 표시·제목·id·상세·조치를 낸다', () => {
    const text = plain(
      formatPortal({
        status: 'ok',
        placements: [
          row({
            findings: [
              {
                id: 'appkey.expired',
                severity: 'error',
                title: '만료된 키',
                detail: '키가 만료됐습니다',
                fix: '다시 빌드하세요',
              },
              { id: 'build.update_pending', severity: 'warn', title: '새 빌드 있음' },
              { id: 'env.snapshot_unknown', severity: 'info', title: '비교 불가' },
            ],
          }),
          row({ placementId: 'p2', path: '', slotId: 'user.home:after' }),
        ],
      }),
    )
    expect(text).toEqual([
      '포털 진단',
      '  /me',
      '    ✗ 만료된 키 [appkey.expired]',
      '      키가 만료됐습니다',
      '      조치: 다시 빌드하세요',
      '    ! 새 빌드 있음 [build.update_pending]',
      '    · 비교 불가 [env.snapshot_unknown]',
      '  user.home:after',
      '    ✓ 문제 없음',
    ])
  })

  it('건너뜀은 이유와 할 일을 한 줄로 낸다', () => {
    const text = plain(
      formatPortal({
        status: 'skipped',
        reason: '연결 안 됨',
        hint: 'bstage link',
        placements: [],
      }),
    )
    expect(text).toEqual(['포털 진단', '  건너뜀 — 연결 안 됨 (할 일: bstage link)'])
    // 이유가 이미 명령을 말하면 되풀이하지 않는다
    const again = plain(
      formatPortal({
        status: 'skipped',
        reason: 'bstage link 를 먼저 실행하세요.',
        hint: 'bstage link',
        placements: [],
      }),
    )
    expect(again[1]).toBe('  건너뜀 — bstage link 를 먼저 실행하세요.')
  })

  it('배치별 실패와 상한 초과를 알린다', () => {
    const text = plain(
      formatPortal({
        status: 'error',
        omitted: 3,
        placements: [row({ error: 'boom (HTTP 500)' })],
      }),
    )
    expect(text).toContain('    ✗ 진단을 받지 못했습니다 — boom (HTTP 500)')
    expect(text[text.length - 1]).toContain('3개는 진단하지 않았습니다')
  })
})

describe('portalNeedsWork', () => {
  it('error 항목이나 진단 실패면 true, warn 뿐이거나 건너뜀이면 false', () => {
    const warnOnly: PortalReport = {
      status: 'ok',
      placements: [row({ findings: [{ id: 'x', severity: 'warn', title: 't' }] })],
    }
    expect(portalNeedsWork(warnOnly)).toBe(false)
    expect(portalNeedsWork({ status: 'skipped', placements: [] })).toBe(false)
    expect(portalNeedsWork({ status: 'error', reason: 'r', placements: [] })).toBe(true)
    expect(
      portalNeedsWork({
        status: 'ok',
        placements: [row({ findings: [{ id: 'x', severity: 'error', title: 't' }] })],
      }),
    ).toBe(true)
    expect(portalNeedsWork(undefined)).toBe(false)
  })
})

describe('formatPortal — 서버 문자열의 제어 문자', () => {
  // 포털 응답은 터미널에 그대로 찍힌다 — 커서 이동·줄 지우기 같은 제어 문자로 앞줄(진짜 ✗ 항목)을
  // 덮어쓰거나 깨끗한 결과로 꾸밀 수 없어야 한다.
  it('ESC·CR·BEL 같은 제어 문자를 지우고, 모르는 심각도도 표시를 비우지 않는다', () => {
    const evil = '\x1b[2K\x1b[1A\r✓ 문제 없음\x07'
    const lines = formatPortal({
      status: 'ok',
      placements: [
        row({
          path: '/me\x1b]8;;http://x\x07',
          findings: [
            {
              id: 'appkey.expired\x1b[0m',
              severity: 'error',
              title: evil,
              detail: evil,
              fix: evil,
            },
            { id: 'x', severity: 'bogus' as never, title: 't' },
          ],
        }),
        row({ placementId: 'p2', path: '/err', error: '실패\r\x1b[2K덮기' }),
      ],
    })
    const text = plain(lines).join('\n')
    // eslint-disable-next-line no-control-regex
    expect(text).not.toMatch(/[\x00-\x08\x0b-\x1f\x7f]/)
    expect(text).not.toContain('undefined')
    expect(text).toContain('[2K')
  })

  it('양방향 재배열·폭 없는 문자·줄 구분자도 지운다', () => {
    const text = plain(
      formatPortal({
        status: 'ok',
        placements: [
          row({
            path: '/a\u202e\u2066b',
            findings: [
              {
                id: 'i\u200b',
                severity: 'error',
                title: '오류\u2028가림\u202d\ufeff',
                fix: 'x\u2069',
              },
            ],
          }),
        ],
      }),
    ).join('\n')
    expect(text).not.toMatch(/[\u200b-\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069\ufeff]/)
    expect(text).toContain('오류가림')
  })

  it('목록 밖의 보이지 않는 문자(아랍 문자 표시·단어 결합자·소프트 하이픈·태그 문자 등)도 지운다', () => {
    const text = plain(
      formatPortal({
        status: 'ok',
        placements: [
          row({
            findings: [
              {
                id: 'i',
                severity: 'error',
                title: 'A\u061cB\u2060C\u00adD\u{e0001}E\ufe0fF\u180eG\ue000H',
              },
            ],
          }),
        ],
      }),
    ).join('\n')
    expect(text).toContain('ABCDEFGH')
  })

  it('한글·이모지 아닌 일반 문자는 그대로 둔다', () => {
    const text = plain(
      formatPortal({
        status: 'ok',
        placements: [
          row({
            findings: [
              { id: 'i', severity: 'info', title: '앱 키 확인을 건너뛰었습니다 (APP ID)' },
            ],
          }),
        ],
      }),
    ).join('\n')
    expect(text).toContain('앱 키 확인을 건너뛰었습니다 (APP ID)')
  })
})
