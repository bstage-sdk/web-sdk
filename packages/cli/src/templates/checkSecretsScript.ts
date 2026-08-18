/**
 * 스캐폴드 `.husky/check-secrets.mjs` — pre-commit 시크릿 가드(자립 실행 node 스크립트).
 *
 * 스테이지된 변경(`git diff --cached`)에서 앱키/시크릿 리터럴을 정규식으로 검출해 커밋을 차단한다.
 * cli·외부 패키지 의존 없이 node만으로 동작한다. `bstage init`이 생성하고 `bstage skills install`이 갱신한다.
 *
 * 주의: 생성 코드는 백슬래시·백틱·`${}`를 쓰지 않도록 작성했다(이 템플릿 리터럴에서 이스케이프가 필요 없게).
 * 개행/NUL은 `String.fromCharCode`로, 문자열 조립은 `+` 연결로 처리한다.
 */
export function checkSecretsScript(): string {
  return `/* eslint-disable */
// bstage 시크릿 가드 — SDK가 관리하는 파일입니다. 직접 편집하지 마세요(bstage skills install이 갱신).
// 스테이지된 변경에서 앱키(bsa_/bsm_/bsp_)·GitHub PAT 리터럴을 검출해 커밋을 차단한다.
import { execFileSync } from 'node:child_process'
import { basename } from 'node:path'

const LF = String.fromCharCode(10)
const NUL = String.fromCharCode(0)
const PATTERNS = [
  { label: '앱키', re: /bs[amp]_[A-Za-z0-9]{16,}/g },
  { label: 'GitHub PAT', re: /ghp_[A-Za-z0-9]{36}/g },
  { label: 'GitHub PAT', re: /github_pat_[A-Za-z0-9_]{82}/g },
]
const HINTS = ['YOUR', 'EXAMPLE', 'PLACEHOLDER', 'XXXX']

function isPlaceholder(token, line) {
  const upper = line.toUpperCase()
  if (HINTS.some((h) => upper.includes(h))) return true
  const body = token.slice(token.indexOf('_') + 1)
  return body.length > 0 && body.split('').every((c) => c === body[0])
}
function mask(token) {
  const us = token.indexOf('_')
  const prefix = us >= 0 ? token.slice(0, us + 1) : token.slice(0, 4)
  return prefix + '****'
}
function git(args) {
  return execFileSync('git', args, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] })
}

let out
try {
  out = git(['-c', 'core.quotepath=false', 'diff', '--cached', '--name-only', '--diff-filter=ACM'])
} catch {
  process.exit(0)
}
const files = out
  .split(LF)
  .map((s) => s.trim())
  .filter(Boolean)
const findings = []

for (const f of files) {
  const base = basename(f)
  if (base === '.env' || base.endsWith('.local')) {
    findings.push({ file: f, line: 0, label: '.env 파일', masked: base })
  }
}
for (const f of files) {
  if (basename(f) === '.env.example') continue
  let content
  try {
    content = git(['show', ':' + f])
  } catch {
    continue
  }
  if (content.includes(NUL)) continue
  const lines = content.split(LF)
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    for (const p of PATTERNS) {
      p.re.lastIndex = 0
      let m
      while ((m = p.re.exec(line)) !== null) {
        const token = m[0]
        if (p.label === '앱키' && isPlaceholder(token, line)) continue
        findings.push({ file: f, line: i + 1, label: p.label, masked: mask(token) })
      }
    }
  }
}

if (findings.length === 0) process.exit(0)

console.error('')
console.error('✗ 커밋 차단: 스테이지된 변경에 키/시크릿 리터럴이 있습니다.')
for (const x of findings) {
  if (x.line === 0) {
    console.error('  ' + x.file + ' — .env류 파일은 커밋하지 마세요 (git add -f로 강제됨?)')
  } else {
    console.error('  ' + x.file + ':' + x.line + ' — ' + x.label + ' 리터럴 (' + x.masked + ')')
  }
}
console.error('')
console.error('  인증 값은 .env(커밋 안 됨) + import.meta.env로 주입하세요. 노출된 키는 폐기·재발급이 필요합니다.')
console.error('')
process.exit(1)
`
}
