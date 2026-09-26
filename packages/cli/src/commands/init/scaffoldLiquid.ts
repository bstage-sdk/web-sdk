import { agentsMd, claudeMd, skillsFor } from '@bstage-sdk/ai-toolkit'
import type { DesignTarget } from '@bstage-sdk/ai-toolkit'

import { pnpmWorkspace } from '../../templates/pnpmWorkspace.js'
import { gitignore } from '../../templates/gitignore.js'
import { huskyPreCommit } from '../../templates/huskyPreCommit.js'
import { checkSecretsScript } from '../../templates/checkSecretsScript.js'
import { liquidPackageJson } from '../../templates/liquid/packageJson.js'
import { liquidReadme } from '../../templates/liquid/readme.js'
import { liquidTemplate } from '../../templates/liquid/templateLiquid.js'
import { liquidDataJson } from '../../templates/liquid/dataJson.js'

import type { Scaffold, ScaffoldFile } from './scaffold.js'

/**
 * liquid 템플릿 폴더 이름 규칙 — **소문자로 시작 + 소문자·숫자·하이픈, 한 세그먼트.**
 *
 * sdk의 Custom Element 규칙(`ELEMENT_NAME_RE`)과 달리 하이픈을 요구하지 않는다. 이 이름은
 * 태그명이 아니라 `public/{surface}/{name}/` 디렉터리명이고, 빌더가 **정확히 한 세그먼트**만
 * 인정하므로(`detectProjectKind` 참조) 슬래시가 들어가면 템플릿이 조용히 무시된다.
 */
export const LIQUID_TEMPLATE_NAME_RE = /^[a-z][a-z0-9-]*$/

/** `scaffoldLiquid`에 넘기는 프로젝트 맥락. 프롬프트·네트워크 조회가 끝난 뒤의 확정값이다. */
export interface LiquidScaffoldInput {
  space: string
  projectName: string
  /** `public/{target}/{templateName}/` 의 폴더명. `LIQUID_TEMPLATE_NAME_RE`를 만족해야 한다. */
  templateName: string
  target: DesignTarget
  packageManager: 'npm' | 'pnpm'
  /** `@bstage-sdk/cli` 최신 버전. liquid는 이 패키지 하나만 의존한다. */
  cliVersion: string
}

/**
 * `bstage init --kind liquid`가 만들 디렉터리·파일 목록을 조립한다. 순수 함수 — 디스크·네트워크·
 * 프롬프트를 건드리지 않으므로 목록 자체를 테스트로 고정할 수 있다(`scaffoldLiquid.test.ts`).
 *
 * sdk 스캐폴드와의 차이는 **없는 것**에 있다: `src/`·vite·tsconfig·eslint·`.env`가 모두 빠진다.
 * 번들링도 타입 검사도 하지 않고, 인증 키를 쓰는 클라이언트 코드도 없기 때문이다. 섞여 들어가면
 * 포털 빌더가 레포를 `mixed`로 보거나 불필요한 설정이 남는다.
 */
export function scaffoldLiquid(input: LiquidScaffoldInput): Scaffold {
  return { dirs: buildDirs(input), files: buildFiles(input) }
}

/**
 * 디렉토리 구조. 템플릿 한 벌(`public/{target}/{name}`)과 스킬 디렉터리만 만든다 —
 * 깊이가 규약(빌더가 인정하는 `public/{user|admin}/{name}`)에 고정돼 있다.
 */
function buildDirs({ target, templateName }: LiquidScaffoldInput): string[] {
  return [
    '',
    '.husky',
    `public/${target}/${templateName}`,
    ...skillsFor('liquid').map((s) => `.claude/skills/${s.name}`),
  ]
}

function file(path: string, content: string): ScaffoldFile {
  return { path, content }
}

/** 이 프로젝트 종류(liquid)에 해당하는 스킬만 깐다 — sdk 전용 스킬은 들어가지 않는다. */
function buildSkillFiles({ target }: LiquidScaffoldInput): ScaffoldFile[] {
  return skillsFor('liquid').map((s) =>
    file(`.claude/skills/${s.name}/SKILL.md`, s.content({ kind: 'liquid', target })),
  )
}

function buildFiles(input: LiquidScaffoldInput): ScaffoldFile[] {
  const { space, projectName, templateName, target, packageManager, cliVersion } = input
  const templateDir = `public/${target}/${templateName}`
  return [
    file('AGENTS.md', agentsMd({ space, projectName, target, kind: 'liquid' })),
    file('CLAUDE.md', claudeMd()),
    file('README.md', liquidReadme({ projectName, target, name: templateName })),
    file('package.json', liquidPackageJson({ projectName, target, cliVersion })),
    // sdk와 같은 .gitignore를 쓴다 — Vite 항목이 남지만 무해하고, 두 벌을 따로 갱신하지 않는다.
    file('.gitignore', gitignore()),
    // pnpm은 이 파일이 없으면 workspace 루트 판정·build script 차단으로 install이 죽는다.
    ...(packageManager === 'pnpm' ? [file('pnpm-workspace.yaml', pnpmWorkspace())] : []),
    file('.husky/pre-commit', huskyPreCommit()),
    file('.husky/check-secrets.mjs', checkSecretsScript()),
    file(`${templateDir}/template.liquid`, liquidTemplate({ name: templateName, target })),
    file(`${templateDir}/data.json`, liquidDataJson({ name: templateName, target })),
    ...buildSkillFiles(input),
  ]
}
