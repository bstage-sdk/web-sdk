import { extname } from 'node:path'

import type { LiquidPreviewError, LiquidSurface } from './render.js'
import { RELOAD_PATH } from './routes.js'
import { templatesOf, type PreviewInventory, type PreviewTemplate } from './templates.js'

/** 확장자 → content-type. 표에 없으면 다운로드로 떨어뜨린다(브라우저가 실행하지 않게). */
const CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.mp4': 'video/mp4',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
}

export const DEFAULT_CONTENT_TYPE = 'application/octet-stream'

export function contentTypeFor(filePath: string): string {
  return CONTENT_TYPES[extname(filePath).toLowerCase()] ?? DEFAULT_CONTENT_TYPE
}

/** 파일이 바뀌면 서버가 보내는 SSE를 받아 새로고침한다. 프리뷰 전용이라 배포물과 무관하다. */
const RELOAD_SCRIPT = `<script>
  new EventSource('${RELOAD_PATH}').onmessage = function () {
    location.reload()
  }
</script>`

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * 렌더 결과에 리로드 스크립트를 붙인다. `</body>`가 있으면 그 앞에, 없으면 끝에 — 템플릿이
 * 조각 HTML일 수도 있기 때문이다. 원본 문자열은 바꾸지 않는다.
 */
export function injectReloadScript(html: string): string {
  const at = html.lastIndexOf('</body>')
  if (at === -1) return `${html}\n${RELOAD_SCRIPT}\n`
  return `${html.slice(0, at)}${RELOAD_SCRIPT}\n${html.slice(at)}`
}

function shell(title: string, body: string): string {
  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(title)}</title>
<style>
body{margin:0;padding:40px 24px;font-family:system-ui,sans-serif;line-height:1.6;color:#222}
main{max-width:720px;margin:0 auto}
h1{margin:0 0 4px;font-size:22px}
p{margin:0 0 20px;color:#666;font-size:14px}
ul{margin:0 0 24px;padding:0;list-style:none}
li{padding:8px 0;border-bottom:1px solid #eee}
a{color:#1a56db;text-decoration:none}
small{margin-left:8px;color:#9a3412;font-size:13px}
code{background:#f4f4f5;padding:1px 5px;border-radius:3px;font-size:13px}
pre{background:#f4f4f5;padding:12px;border-radius:4px;overflow:auto;font-size:13px}
</style>
</head>
<body>
<main>
${body}
</main>
${RELOAD_SCRIPT}
</body>
</html>
`
}

/** 규약 밖 템플릿에 붙는 한 줄. 표현을 한 곳에 모아 목록·경고 문구가 어긋나지 않게 한다. */
const IGNORED_NOTE = '깊이가 규약(public/{user|admin}/{이름})과 달라 포털이 무시합니다'

function templateItem(t: PreviewTemplate): string {
  const link = `<a href="/${escapeHtml(t.id)}">${escapeHtml(t.name)}</a>`
  return t.ignored ? `<li>${link}<small>${IGNORED_NOTE}</small></li>` : `<li>${link}</li>`
}

function unreachableItems(inventory: PreviewInventory): string {
  if (inventory.unreachable.length === 0) return ''
  const items = inventory.unreachable
    .map((p) => `<li><code>${escapeHtml(p)}</code><small>${IGNORED_NOTE}</small></li>`)
    .join('\n')
  return `<h1>규약 밖 파일</h1>\n<ul>\n${items}\n</ul>`
}

export function indexPage(inventory: PreviewInventory): string {
  const counts = (['user', 'admin'] as const).map(
    (type) =>
      `<li><a href="/${type}">${type}</a><small>${templatesOf(inventory, type).length}개</small></li>`,
  )
  const body = [
    '<h1>b.stage liquid 프리뷰</h1>',
    '<p>인증 프록시와 phase는 쓰지 않습니다. 값은 템플릿 폴더의 data.json에서 옵니다.</p>',
    `<ul>\n${counts.join('\n')}\n</ul>`,
    unreachableItems(inventory),
  ]
  return shell('b.stage liquid 프리뷰', body.filter(Boolean).join('\n'))
}

export function listPage(type: LiquidSurface, inventory: PreviewInventory): string {
  const items = templatesOf(inventory, type).map(templateItem)
  const list =
    items.length > 0
      ? `<ul>\n${items.join('\n')}\n</ul>`
      : `<p>public/${type}/{이름}/template.liquid 가 아직 없습니다.</p>`
  const body = [`<h1>${type}</h1>`, '<p><a href="/">전체 목록</a></p>', list].join('\n')
  return shell(`${type} 템플릿`, body)
}

/**
 * 렌더 실패 화면. **500이 아니라 200으로** 내보낸다 — 비개발자에게는 이 화면이 주 진단 수단이라
 * 브라우저 기본 오류 화면에 가려지면 안 되고, 고치는 즉시 리로드로 복구돼야 하기 때문이다.
 */
export function errorPage(err: LiquidPreviewError, displayPath: string): string {
  const where = err.line === undefined ? '' : `<p>${err.line}번째 줄</p>`
  const body = [
    '<h1>렌더 실패</h1>',
    `<p><code>${escapeHtml(displayPath)}</code></p>`,
    where,
    `<pre>${escapeHtml(err.message)}</pre>`,
    '<p>data.json/template.liquid를 고치면 자동으로 다시 불러옵니다.</p>',
  ]
  return shell('렌더 실패', body.filter(Boolean).join('\n'))
}

export function notFoundPage(): string {
  const body = ['<h1>찾을 수 없습니다</h1>', '<p><a href="/">전체 목록</a></p>'].join('\n')
  return shell('찾을 수 없습니다', body)
}
