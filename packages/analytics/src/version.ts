// 빌드 시 tsup의 `define`이 실제 package.json 버전으로 치환한다.
declare const __SDK_VERSION__: string

/** 번들에 심긴 SDK 버전. CDN에 올라간 번들과 npm 버전이 어긋났는지 런타임에 확인한다 */
export const VERSION: string = __SDK_VERSION__
