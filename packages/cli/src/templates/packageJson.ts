import type { DesignTarget } from './designGuide.js'

interface PackageJsonOptions {
  projectName: string
  /**
   * 프로젝트가 올라가는 플랫폼. `bstage.target`으로 기록되어 doctor·skills·dev 서버가 읽는다.
   * 프로젝트 단위인 이유는 `resolveProjectTarget` 주석 참조.
   */
  target?: DesignTarget
  sdkVersions: {
    cli: string
    core: string
    react: string
    design: string
  }
}

export function packageJson({
  projectName,
  target = 'user',
  sdkVersions,
}: PackageJsonOptions): string {
  // user 흐름 무변화를 위해 기존 키 순서를 그대로 유지한다.
  const dependencies: Record<string, string> = {
    '@bstage-sdk/cli': sdkVersions.cli,
    '@bstage-sdk/core': sdkVersions.core,
    '@bstage-sdk/design': sdkVersions.design,
    '@bstage-sdk/react': sdkVersions.react,
    react: '^19.2.0',
    'react-dom': '^19.2.0',
  }

  const devDependencies: Record<string, string> = {
    '@eslint/js': '^9.39.0',
    // tsconfig.node.json이 `types: ['node']`를 선언하고 vite.config.ts가 `process.cwd()`를 쓴다.
    // 이게 없으면 `npm run typecheck`(tsc -b)가 TS2688로 깨진다.
    '@types/node': '^24.0.0',
    '@types/react': '^19.2.0',
    '@types/react-dom': '^19.2.0',
    '@vitejs/plugin-react': '^5.2.0',
    eslint: '^9.39.0',
    'eslint-plugin-react-hooks': '^7.0.0',
    'eslint-plugin-react-refresh': '^0.4.0',
    globals: '^16.0.0',
    husky: '^9.1.7',
    typescript: '~5.9.0',
    'typescript-eslint': '^8.0.0',
    vite: '^7.0.0',
  }

  return JSON.stringify(
    {
      name: projectName,
      private: true,
      version: '0.0.0',
      type: 'module',
      bstage: { target },
      scripts: {
        dev: 'vite dev',
        build: 'bstage build',
        // `bstage build`는 tsc를 타지 않는다 — 타입 게이트는 이 스크립트가 유일하다.
        // solution-style tsconfig(files: [])라 `tsc --noEmit`은 아무것도 검사하지 않으므로 `-b`를 쓴다.
        typecheck: 'tsc -b',
        lint: 'eslint .',
        // install 시 husky가 .husky/ 훅(pre-commit 시크릿 가드)을 활성화한다.
        prepare: 'husky',
      },
      dependencies,
      devDependencies,
    },
    null,
    2,
  )
}
