#!/usr/bin/env node
/**
 * build-css — 빌드된 토큰(dist)에서 dev fallback CSS 파일을 생성한다.
 * tsup 빌드 이후 실행: `tsup && node scripts/build-css.mjs`
 *
 * 산출물(커밋 대상 아님 — files 배열의 css/ 로 배포):
 *   css/user.css  (:root, light + dark)
 *   css/admin.css (:root, light 전용)
 */
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const pkgRoot = join(__dirname, '..')

async function main() {
  const user = await import(join(pkgRoot, 'dist', 'user', 'index.js'))
  const admin = await import(join(pkgRoot, 'dist', 'admin', 'index.js'))

  const cssDir = join(pkgRoot, 'css')
  mkdirSync(cssDir, { recursive: true })

  writeFileSync(join(cssDir, 'user.css'), user.renderCss(), 'utf-8')
  writeFileSync(join(cssDir, 'admin.css'), admin.renderCss(), 'utf-8')

  console.log('✓ css/user.css, css/admin.css 생성')
}

main().catch((err) => {
  console.error('❌ build-css 실패:', err)
  process.exit(1)
})
