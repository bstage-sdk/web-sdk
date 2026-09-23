// 빌드 시 tsup의 `define`이 실제 package.json 버전으로 치환한다(테스트는 vitest.config 의 define).
declare const __TOOLKIT_VERSION__: string

/** 번들에 심긴 ai-toolkit 버전. */
export const VERSION: string = __TOOLKIT_VERSION__
