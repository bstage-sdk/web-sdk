/**
 * 스캐폴드 `.husky/pre-commit` 훅 본문.
 *
 * husky v9 포맷(shebang·source 라인 불필요, 실행 비트도 `.husky/_` 래퍼가 담당해 불요).
 * 자립 node 스크립트 `.husky/check-secrets.mjs`를 실행해 스테이지된 변경의 키/시크릿 리터럴을
 * 검출·차단한다. cli·npx 의존 없이 node만 쓴다(스캐폴드는 이미 node 프로젝트).
 */
export function huskyPreCommit(): string {
  return `node .husky/check-secrets.mjs
`
}
