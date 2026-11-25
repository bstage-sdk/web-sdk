import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { CLI_TOKEN_MENU } from './constants.js'

// CLI 토큰 발급 위치는 CLI 문구(CLI_TOKEN_MENU)와 문서가 같은 표기를 써야 한다.
// 콘솔 메뉴가 옮겨져 상수를 바꾸면 이 테스트가 문서도 같이 고치라고 알려 준다.
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const DOCS = ['README.md', 'docs/GETTING_STARTED.md']

describe('CLI 토큰 발급 위치 — 문서와 CLI 문구 동기화', () => {
  for (const doc of DOCS) {
    it(`${doc}가 CLI와 같은 위치(${CLI_TOKEN_MENU})를 안내한다`, () => {
      const text = readFileSync(join(REPO_ROOT, doc), 'utf-8')
      expect(text).toContain(`콘솔 **${CLI_TOKEN_MENU}**`)
      // 위치를 다르게 적은 안내가 남아 있지 않은지 — "콘솔 **<무엇> › CLI 토큰**" 꼴을 모두 모은다.
      const mentions = [...text.matchAll(/콘솔 \*\*([^*]*CLI ?토큰)\*\*/g)].map((m) => m[1])
      expect(mentions.every((m) => m === CLI_TOKEN_MENU)).toBe(true)
    })
  }
})
