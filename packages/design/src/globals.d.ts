// dev 전용 경고 가드(`process.env.NODE_ENV !== 'production'`)를 타입 체크하기 위한 최소 선언.
// @types/node 전체를 끌어오지 않기 위해 필요한 부분만 ambient로 둔다. 번들러가 빌드 시
// `process.env.NODE_ENV`를 정적 치환하므로 프로덕션에서는 가드 블록째로 제거된다.
// (packages/react/src/globals.d.ts와 같은 이유 — design은 react에 의존할 수 없어 따로 둔다.)
declare const process: { readonly env: { readonly NODE_ENV?: string } }
