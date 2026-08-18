import type { Plugin } from 'vite'

export interface ExtractedMeta {
  name: string
  elementName: string
  /** 위젯이 들어갈 슬롯 id. 빌드가 산출물 디렉토리 이름을 정하는 데 쓴다. 페이지에는 없다. */
  slot?: string
  type?: string
  framework?: string
}

/**
 * 빌드 시 소스코드에서 createTemplate() / createWebComponent() 호출을 파싱하여
 * 템플릿 메타데이터를 추출하는 Vite 플러그인을 생성한다.
 */
export function createMetaPlugin(): { plugin: Plugin; getMeta: () => ExtractedMeta | null } {
  let meta: ExtractedMeta | null = null

  const plugin: Plugin = {
    name: 'bstage-meta-extract',
    enforce: 'pre',

    transform(code, id) {
      if (meta) return null
      // .ts .tsx .js .jsx + .mts .mjs .cts .cjs. 이전 `[tjm]sx?`는 자리가 어긋나 `.mjs`를 놓치고
      // 대신 존재하지 않는 `.ms`·`.msx`를 통과시켰다.
      if (!/\.[cm]?[tj]sx?$/.test(id)) return null
      if (!code.includes('createTemplate') && !code.includes('createWebComponent')) return null

      const extracted = extractMeta(code)
      if (extracted) meta = extracted
      return null
    },
  }

  return { plugin, getMeta: () => meta }
}

function extractMeta(code: string): ExtractedMeta | null {
  // import 문에서 프레임워크 감지
  let framework: string | undefined
  if (code.includes("'@bstage-sdk/react'") || code.includes('"@bstage-sdk/react"')) {
    framework = 'react'
  } else if (code.includes("'@bstage-sdk/vue'") || code.includes('"@bstage-sdk/vue"')) {
    framework = 'vue'
  } else if (code.includes("'@bstage-sdk/svelte'") || code.includes('"@bstage-sdk/svelte"')) {
    framework = 'svelte'
  }

  // createTemplate (옵션은 2번째 인자) → createWebComponent (3번째 인자) 순으로 시도
  const attempts: Array<{ fnName: string; argIndex: number }> = [
    { fnName: 'createTemplate', argIndex: 1 },
    { fnName: 'createWebComponent', argIndex: 2 },
  ]

  for (const { fnName, argIndex } of attempts) {
    const idx = code.indexOf(fnName + '(')
    if (idx === -1) continue

    const objStr = findNthObjectArg(code, idx + fnName.length, argIndex)
    if (!objStr) continue

    const name = extractStringProp(objStr, 'name')
    if (!name) continue

    const slot = extractStringProp(objStr, 'slot')
    const type = extractStringProp(objStr, 'type')
    const explicitFramework = extractStringProp(objStr, 'framework')

    return {
      name,
      elementName: name,
      ...(slot && { slot }),
      ...(type && { type }),
      framework: explicitFramework ?? framework,
    }
  }

  return null
}

/**
 * 여는 괄호부터 시작하여 쉼표로 구분된 인자를 n개 건너뛴 뒤,
 * n번째 인자(객체 리터럴)의 텍스트를 반환한다.
 */
function findNthObjectArg(code: string, parenPos: number, n: number): string | null {
  let i = parenPos
  while (i < code.length && code[i] !== '(') i++
  i++ // skip '('

  let argCount = 0
  let depth = 0

  while (i < code.length && argCount < n) {
    const ch = code[i]
    if (ch === '(' || ch === '[' || ch === '{') depth++
    else if (ch === ')' || ch === ']' || ch === '}') depth--
    else if (ch === ',' && depth === 0) argCount++

    // 문자열 리터럴을 건너뛰어 쉼표 오집계 방지
    if (ch === "'" || ch === '"' || ch === '`') {
      i = skipString(code, i)
    }
    i++
  }

  // 공백을 건너뛰어 객체 리터럴 위치로 이동
  while (i < code.length && /\s/.test(code[i])) i++
  if (i >= code.length || code[i] !== '{') return null

  // 중괄호 매칭
  let braceDepth = 0
  const start = i
  while (i < code.length) {
    const ch = code[i]
    if (ch === "'" || ch === '"' || ch === '`') {
      i = skipString(code, i)
    } else if (ch === '{') {
      braceDepth++
    } else if (ch === '}') {
      braceDepth--
      if (braceDepth === 0) return code.slice(start, i + 1)
    }
    i++
  }
  return null
}

/** 위치 `i`에서 시작하는 문자열 리터럴을 건너뛰고, 닫는 따옴표의 인덱스를 반환한다. */
function skipString(code: string, i: number): number {
  const quote = code[i]
  i++
  while (i < code.length && code[i] !== quote) {
    if (code[i] === '\\') i++
    i++
  }
  return i
}

function extractStringProp(objStr: string, key: string): string | undefined {
  const regex = new RegExp(`(?:^|[,{\\s])\\s*${key}\\s*:\\s*['"\`]([^'"\`]+)['"\`]`)
  return objStr.match(regex)?.[1]
}
