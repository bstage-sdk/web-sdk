// 테스트(`createSrcdoc.test.ts`·`dist.smoke.test.ts`)가 쓰는 node 모듈의 최소 선언. @types/node 전체를
// 끌어오지 않기 위해 필요한 부분만 ambient로 둔다(react 패키지의 globals.d.ts와 같은 방식).
// 번들에는 실리지 않는다.
declare module 'node:vm' {
  export function createContext(sandbox: Record<string, unknown>): Record<string, unknown>
  export function runInContext(code: string, context: Record<string, unknown>): unknown
}

declare module 'node:fs' {
  export function existsSync(path: string | URL): boolean
  export function readFileSync(path: string | URL, encoding: 'utf-8'): string
}
