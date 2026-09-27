// 빌드 시 tsup의 `define`이 실제 package.json 버전으로 치환한다(테스트는 vitest.config 의 define).
declare const __SDK_VERSION__: string

/**
 * 번들에 심긴 core 버전. `BstageClient`가 모든 요청에 `x-bmf-sdk-version` 헤더로 실어
 * 게이트웨이 로그에서 어느 SDK 버전이 쓰이는지 볼 수 있게 한다.
 */
export const VERSION: string = __SDK_VERSION__
