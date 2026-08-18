/**
 * pnpm 프로젝트용 `pnpm-workspace.yaml`.
 *
 * **왜 필요한가** — pnpm 10부터 의존성의 build script(postinstall 등)를 기본 차단하고, pnpm 11은
 * 차단 사실을 **경고가 아니라 에러**로 낸다(`ERR_PNPM_IGNORED_BUILDS`). 스캐폴드는 vite를 쓰고
 * vite는 esbuild를 끌어오므로, 선언이 없으면 `pnpm install`이 실패하고 `pnpm dev`도 같이 죽는다
 * (pnpm이 run 전에 install 상태를 확인하며 자동 install을 돌린다).
 *
 * **왜 이 파일인가** — pnpm 11은 `package.json`의 `pnpm.onlyBuiltDependencies`를 읽지 않고,
 * `pnpm-workspace.yaml`의 **`allowBuilds`** 맵을 본다(`pnpm approve-builds`·`--allow-build`가
 * 기록하는 자리와 같다). 이름이 바뀐 옛 키(`onlyBuiltDependencies`)는 pnpm 11에서 무시된다.
 *
 * **왜 `packages`가 있나** — pnpm 9는 이 파일이 있으면 workspace 루트로 보고, `packages`가
 * 없으면 install·run을 `ERROR packages field missing or empty`로 즉시 중단한다. 소비자가 쓰는
 * pnpm 메이저를 우리가 고를 수 없고(관리도구는 corepack이 주는 버전으로 빌드한다), 단일
 * 프로젝트라 루트만 넣으면 9·10·11이 모두 통과한다.
 *
 * npm 프로젝트에는 만들지 않는다 — npm은 build script를 막지 않는다.
 */
export function pnpmWorkspace(): string {
  return `# pnpm 9는 이 파일이 있으면 workspace 루트로 보고, packages가 없으면 install이 죽는다.
# 단일 프로젝트이므로 루트만 선언한다.
packages:
  - '.'

# pnpm은 의존성 build script를 기본 차단하고, 차단 시 install이 에러로 끝난다.
# 아래에서 허용할 패키지를 명시한다. 새 패키지가 필요해지면 \`pnpm approve-builds\`가
# 이 파일에 항목을 추가해 준다(값을 true로 바꿔야 적용된다).
allowBuilds:
  # vite가 쓰는 번들러. postinstall이 플랫폼 바이너리를 놓는다.
  esbuild: true
`
}
