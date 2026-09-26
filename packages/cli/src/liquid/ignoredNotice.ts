/** 포털이 인정하는 liquid 템플릿 자리. 문구 한 곳에서만 쓴다. */
const ACCEPTED = 'public/{user|admin}/{이름}/template.liquid'

/**
 * 규약 밖 `.liquid` 파일 안내. `bstage dev`·`build`가 같은 문구를 낸다 — 프리뷰에서는 "포털이
 * 무시합니다"라고 목록에만 표시되고 터미널에는 아무 말이 없어, 배포 뒤에야 빈 자리를 보게 됐다.
 * 무시된 파일이 없으면 null.
 */
export function ignoredLiquidNotice(files: readonly string[]): string | null {
  if (files.length === 0) return null
  return (
    `template.liquid 가 있지만 포털이 인식하지 않는 자리에 있습니다.\n` +
    `  인정되는 자리: ${ACCEPTED} (세그먼트 하나)\n` +
    files.map((f) => `    - ${f}`).join('\n') +
    `\n  폴더를 위 규약에 맞게 옮긴 뒤 다시 실행하세요.`
  )
}
