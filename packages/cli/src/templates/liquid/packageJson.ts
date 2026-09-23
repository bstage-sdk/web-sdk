import type { DesignTarget } from '@bstage-sdk/ai-toolkit'

interface LiquidPackageJsonOptions {
  projectName: string
  /** 첫 템플릿이 올라가는 플랫폼. `bstage.target`으로 기록되어 doctor·skills가 읽는다. */
  target?: DesignTarget
  /** `@bstage-sdk/cli` 버전. liquid 프로젝트가 의존하는 유일한 SDK 패키지다. */
  cliVersion: string
}

/**
 * liquid 프로젝트의 `package.json`.
 *
 * sdk 스캐폴드와 달리 **런타임 의존이 없다** — liquid는 서버가 렌더하므로 번들링 대상이 아니고,
 * cli는 저작 도구(dev 미리보기·검증·배포)로만 들어간다. react·vite·tsconfig가 없는 이유도 같다.
 */
export function liquidPackageJson({
  projectName,
  target = 'user',
  cliVersion,
}: LiquidPackageJsonOptions): string {
  return JSON.stringify(
    {
      name: projectName,
      private: true,
      version: '0.0.0',
      type: 'module',
      // kind는 이 스캐폴드가 liquid 프로젝트임을 남기는 기록이다. 판정 자체는 파일 구조로 한다
      // (`detectProjectKind`는 이 값을 읽지 않는다) — 포털 빌더와 어긋나면 안 된다.
      bstage: { kind: 'liquid', target },
      scripts: {
        dev: 'bstage dev',
        // liquid는 번들을 만들지 않는다 — build는 구조·문법 검증이다.
        build: 'bstage build',
        deploy: 'bstage deploy',
        // install 시 husky가 .husky/ 훅(pre-commit 시크릿 가드)을 활성화한다.
        prepare: 'husky',
      },
      dependencies: {
        '@bstage-sdk/cli': cliVersion,
      },
      devDependencies: {
        husky: '^9.1.7',
      },
    },
    null,
    2,
  )
}
