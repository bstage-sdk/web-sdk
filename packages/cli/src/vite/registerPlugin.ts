import type { Plugin } from 'vite'

/**
 * template 엔트리 파일에 Web Component 자동 등록 코드를 주입하는 Vite 플러그인.
 *
 * transform 훅에서 template 파일의 코드 끝에 registerTemplate 호출을 추가.
 * __bstage_registry__를 순회하여 모든 createTemplate 결과를 WC로 등록.
 *
 * 유저·어드민 템플릿이 같은 등록 경로를 쓴다 — 어댑터가 하나이므로 분기가 없다.
 */
export function createRegisterPlugin(): Plugin {
  return {
    name: 'bstage-auto-register',
    enforce: 'post',

    config() {
      return {
        optimizeDeps: {
          include: ['react-dom/client'],
        },
      }
    },

    transform(code, id) {
      if (!id.endsWith('template.tsx') && !id.endsWith('template.ts')) return null
      if (!code.includes('createTemplate')) return null

      const injection = `\nimport { __bstage_registry__ as __reg__, registerTemplate as __registerTemplate__ } from '@bstage-sdk/react';\n__reg__.forEach(__registerTemplate__);\n`

      return {
        code: code + injection,
        map: null,
      }
    },
  }
}
