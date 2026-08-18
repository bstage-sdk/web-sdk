/**
 * dev 전용 경고 유틸.
 *
 * 호출부를 `if (process.env.NODE_ENV !== 'production') { ... }`로 감싸 쓴다. 번들러(Vite 등)가
 * 프로덕션 빌드에서 `process.env.NODE_ENV`를 정적 치환하므로 그 가드 블록(경고 문자열 포함)이
 * 통째로 dead-code 제거된다.
 *
 * `@bstage-sdk/react`의 `devWarn`과 같은 패턴이지만, design은 leaf 패키지라
 * react에 의존할 수 없어 따로 둔다.
 */
const warned = new Set<string>()

/** 같은 `dedupeKey`는 1회만 경고한다(매 렌더 호출 시 스팸 방지). */
export function devWarnOnce(dedupeKey: string, message: string): void {
  if (warned.has(dedupeKey)) return
  warned.add(dedupeKey)
  console.warn(`[bstage-design] ${message}`)
}
