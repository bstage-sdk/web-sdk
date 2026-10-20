const HTML_ESCAPES: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}

/** HTML 텍스트·속성 값 이스케이프. */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch])
}

/**
 * `<script>` 안에 넣을 JS 리터럴. JSON으로 직렬화한 뒤 `<`·`>`·`&`·U+2028·U+2029를 유니코드
 * 이스케이프로 바꿔 `</script>`·`<!--`로 스크립트 블록을 빠져나가지 못하게 한다.
 */
export function toScriptLiteral(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')
}
