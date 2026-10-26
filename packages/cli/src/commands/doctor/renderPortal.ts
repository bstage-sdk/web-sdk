import pc from 'picocolors'
import type { DiagnosisFinding } from '../../portal/types.js'
import type { PortalPlacementResult, PortalReport } from './portal.js'

/**
 * `bstage doctor`의 "포털 진단" 절. 순수 함수(`formatPortal`)가 줄을 만들고 `printPortal`이 찍는다.
 * 배치마다 이름(경로 또는 슬롯 id) 아래에 진단 항목을 심각도 표시와 함께 늘어놓는다.
 */

const MARKERS: Record<DiagnosisFinding['severity'], string> = {
  error: pc.red('✗'),
  warn: pc.yellow('!'),
  info: pc.dim('·'),
}

/**
 * 서버가 준 문자열을 터미널에 찍기 전에 보이지 않는 문자를 지운다 — 제어 문자(Cc), 서식 문자(Cf:
 * 양방향 재배열·폭 없는 문자·태그 문자 등), 사용자 영역(Co), 짝 없는 대리 문자(Cs), 줄·문단 구분자
 * (Zl·Zp), 변이 선택자(Variation_Selector), 소프트 하이픈·몽골어 모음 구분자. ESC·CR로 앞줄을 덮어쓰거나 글자 순서를
 * 뒤집어 진짜 오류 항목을 숨기거나 깨끗한 결과를 꾸미지 못하게 한다. 목록을 손으로 늘리는 대신
 * 유니코드 속성으로 막는다. 탭은 먼저 공백으로 바꾼다.
 */
function clean(s: string | undefined): string {
  return (s ?? '')
    .replace(/\t/g, ' ')
    .replace(/[\p{Cc}\p{Cf}\p{Co}\p{Cs}\p{Zl}\p{Zp}\p{Variation_Selector}\u00ad\u180e]/gu, '')
}

function marker(severity: string): string {
  return MARKERS[severity as DiagnosisFinding['severity']] ?? pc.dim('·')
}

/** 이유 문구가 이미 그 명령을 말하면(resolveContext 메시지 등) 되풀이하지 않는다. */
function hintSuffix(reason: string | undefined, hint: string | undefined): string {
  return hint && !(reason ?? '').includes(hint) ? ` (할 일: ${hint})` : ''
}

function formatFinding(f: DiagnosisFinding): string[] {
  const lines = [`    ${marker(f.severity)} ${clean(f.title)} ${pc.dim(`[${clean(f.id)}]`)}`]
  if (f.detail) lines.push(pc.dim(`      ${clean(f.detail)}`))
  if (f.fix) lines.push(pc.dim(`      조치: ${clean(f.fix)}`))
  return lines
}

function formatPlacement(row: PortalPlacementResult): string[] {
  const label = clean(row.path || row.slotId || row.placementId)
  const lines = [`  ${pc.bold(label)}`]
  if (row.error !== undefined) {
    lines.push(`    ${pc.red('✗')} 진단을 받지 못했습니다 — ${clean(row.error)}`)
  } else if (row.findings.length === 0) {
    lines.push(`    ${pc.green('✓')} 문제 없음`)
  } else {
    lines.push(...row.findings.flatMap(formatFinding))
  }
  return lines
}

/** 포털 진단 절의 줄들. 건너뜀·미지원·실패는 한 줄로 이유와 할 일만 보인다. */
export function formatPortal(p: PortalReport): string[] {
  const lines = [pc.bold('콘솔 진단')]
  if (p.status === 'skipped') {
    lines.push(
      pc.dim(
        `  건너뜀 — ${clean(p.reason) || '로그인·링크가 없습니다.'}${hintSuffix(p.reason, p.hint)}`,
      ),
    )
  } else if (p.status === 'unsupported') {
    lines.push(
      pc.dim(`  건너뜀 — ${clean(p.reason) || '콘솔 서버가 아직 진단을 지원하지 않습니다.'}`),
    )
  } else if (p.placements.length === 0) {
    lines.push(
      p.status === 'error'
        ? pc.red(`  ✗ ${clean(p.reason) || '콘솔 진단에 실패했습니다.'}`)
        : pc.dim(
            `  ${clean(p.reason) || '진단할 배치가 없습니다.'}${hintSuffix(p.reason, p.hint)}`,
          ),
    )
  } else {
    lines.push(...p.placements.flatMap(formatPlacement))
  }
  if (p.omitted) {
    lines.push(
      pc.dim(
        `  (배치가 많아 ${p.omitted}개는 진단하지 않았습니다 — bstage doctor --placement <경로|슬롯 id>로 따로 보세요.)`,
      ),
    )
  }
  return lines
}

/** 포털 진단 절을 출력한다. 리포트에 포털 진단이 없으면(로컬 진단만 한 경우) 아무것도 하지 않는다. */
export function printPortal(p: PortalReport | undefined): void {
  if (!p) return
  for (const line of formatPortal(p)) console.log(line)
  console.log('')
}
