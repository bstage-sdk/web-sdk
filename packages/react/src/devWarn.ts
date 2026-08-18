/**
 * dev 전용 경고 유틸.
 *
 * 호출부를 `if (process.env.NODE_ENV !== 'production') { ... }`로 감싸 쓴다. 번들러(Vite 등)가
 * 프로덕션 빌드에서 `process.env.NODE_ENV`를 정적 치환하므로 그 가드 블록(경고 문자열 포함)이
 * 통째로 dead-code 제거된다 — React가 쓰는 방식과 동일. dev에선 `[bstage]` 프리픽스로 1회만 경고한다.
 *
 * 반환값·동작에는 영향을 주지 않는 순수 side-effect다(진단 전용).
 */
const warned = new Set<string>()

/** 같은 `dedupeKey`는 1회만 `[bstage]` 프리픽스로 경고한다(반복 렌더/호출 시 스팸 방지). */
export function devWarnOnce(dedupeKey: string, message: string): void {
  if (warned.has(dedupeKey)) return
  warned.add(dedupeKey)
  console.warn(`[bstage] ${message}`)
}
