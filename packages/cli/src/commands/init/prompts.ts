import * as p from '@clack/prompts'
import pc from 'picocolors'

import type { DesignTarget, ProjectKind } from '@bstage-sdk/ai-toolkit'

import { LIQUID_TEMPLATE_NAME_RE } from './scaffoldLiquid.js'

export type Phase = 'dev' | 'qa' | 'real' | 'sandbox'
export const PHASES: readonly Phase[] = ['dev', 'qa', 'real', 'sandbox'] as const

/**
 * 첫 템플릿의 target. 프로젝트 전체를 가르지 않는다 — 스캐폴드는 유저·어드민이 같고,
 * 갈리는 건 생성되는 템플릿이 선언하는 `target`(liquid는 `public/` 아래 surface)뿐이다.
 * 한 레포에 두 종류를 섞어도 되며, 이후 템플릿은 각자 자리를 고른다.
 */
export const TARGETS: readonly DesignTarget[] = ['user', 'admin'] as const

/** 프로젝트를 만드는 방식. sdk=React 컴포넌트, liquid=서버 렌더 템플릿. */
export const KINDS: readonly ProjectKind[] = ['sdk', 'liquid'] as const

export interface InitOptions {
  yes?: boolean
  space?: string
  target?: string
  template?: string
  phase?: string
  pm?: string
  kind?: string
}

/** 프롬프트·옵션 파싱이 끝난 확정값. 이후 단계(버전 조회·스캐폴드)는 이 값만 본다. */
export interface InitAnswers {
  kind: ProjectKind
  space: string
  templateName: string
  packageManager: 'npm' | 'pnpm'
  phase: Phase
  target: DesignTarget
  /** liquid에서는 항상 빈 문자열 — API 키를 쓰는 클라이언트 코드가 없다. */
  appId: string
  appKey: string
  tenantId: string
}

/** 잘못된 옵션은 여기서 끝낸다 — 호출부가 매번 같은 3줄을 반복하지 않도록. */
function fail(message: string): never {
  p.log.error(message)
  p.outro(pc.red('중단되었습니다.'))
  process.exit(1)
}

function cancelled(): never {
  p.outro(pc.red('취소되었습니다.'))
  process.exit(0)
}

/** Custom Element 스펙: 소문자로 시작 + 최소 1개 하이픈 + 소문자·숫자·하이픈만. */
const ELEMENT_NAME_RE = /^[a-z][a-z0-9-]*-[a-z0-9-]*$/

const SPACE_RE = /^[a-zA-Z][a-zA-Z0-9-]*$/

/**
 * 첫 템플릿 이름을 정한다. 명시값이 있으면 그대로, 없으면 space에서 파생한다.
 *
 * **space를 소문자로 내린다.** space 검증(`SPACE_RE`)은 대문자를 허용하는데 Custom Element
 * 스펙(`ELEMENT_NAME_RE`)은 소문자만 받는다. 내리지 않으면 `--space MySpace`가 파생 기본값
 * `MySpace-hello`에서 막혀, 사용자가 적지도 않은 `--template` 탓으로 보이는 오류가 난다.
 *
 * @internal 테스트용으로 노출. public API 아님.
 */
export function resolveTemplateName(space: string, option: string | undefined): string {
  return option ?? `${space.toLowerCase()}-hello`
}

/** liquid 기본 템플릿 폴더명. sdk와 달리 하이픈이 필요 없어 space에서 파생하지 않는다. */
const LIQUID_DEFAULT_TEMPLATE = 'hello'

const LIQUID_NAME_HINT = '폴더 이름 — 소문자·숫자·하이픈'
const ELEMENT_NAME_HINT =
  'Custom Element 스펙: 소문자 시작 + 하이픈 1개 이상 + 소문자/숫자/하이픈만.'

function validateSlug(requiredMessage?: string) {
  return (v: string | undefined) => {
    if (!v?.trim()) return requiredMessage
    if (!SPACE_RE.test(v.trim()))
      return '영문자로 시작해야 하며, 영문, 숫자, 하이픈만 사용할 수 있습니다.'
  }
}

function validateTemplateName(kind: ProjectKind) {
  return (v: string | undefined): string | undefined => {
    if (!v?.trim()) return '템플릿 이름은 필수입니다.'
    if (kind === 'liquid') {
      if (!LIQUID_TEMPLATE_NAME_RE.test(v.trim())) return LIQUID_NAME_HINT
      return
    }
    if (!ELEMENT_NAME_RE.test(v.trim())) return ELEMENT_NAME_HINT
  }
}

/** 파트너 콘솔이 발급하는 인증 값의 접두사 규약. */
const APP_ID_PREFIX = 'bsa_'
const APP_KEY_PREFIX = 'bsp_'

/**
 * APP-ID(`bsa_`)와 APP KEY(`bsp_`)를 서로 반대로 입력한 경우를 감지해 경고한다.
 * 명백한 swap(APP-ID가 `bsp_`로, APP KEY가 `bsa_`로 시작)만 검사하며, 입력을 막지는 않는다.
 * 정상 접두사·빈값은 조용히 통과한다.
 */
function warnIfCredentialsSwapped(appId: string, appKey: string): void {
  if (!appId.startsWith(APP_KEY_PREFIX) && !appKey.startsWith(APP_ID_PREFIX)) return
  p.log.warn(
    `APP-ID와 APP KEY가 서로 바뀐 것 같습니다.\n` +
      `  APP-ID는 "${APP_ID_PREFIX}", APP KEY는 "${APP_KEY_PREFIX}"로 시작합니다.\n` +
      `  파트너 콘솔에서 발급받은 값을 다시 확인해 주세요.`,
  )
}

/** `--kind` 값 검증. 미지정이면 sdk(기존 동작). */
function resolveKind(option: string | undefined): ProjectKind {
  const kind = option ?? 'sdk'
  if (!KINDS.includes(kind as ProjectKind)) {
    fail(`--kind 값은 ${KINDS.join(' | ')} 중 하나여야 합니다.`)
  }
  return kind as ProjectKind
}

/** 비대화형(`--yes`) 경로. 검증에 걸리면 그 자리에서 종료한다. */
function answersFromOptions(options: InitOptions): InitAnswers {
  const kind = resolveKind(options.kind)

  const targetOpt = options.target ?? 'user'
  if (!TARGETS.includes(targetOpt as DesignTarget)) {
    fail(`--target 값은 ${TARGETS.join(' | ')} 중 하나여야 합니다.`)
  }
  if (!options.space) fail('--yes 모드에서는 --space가 필수입니다.')
  if (!SPACE_RE.test(options.space)) {
    fail(
      `${pc.red('--space')} 값은 영문자로 시작해야 하며, 영문, 숫자, 하이픈만 사용할 수 있습니다.`,
    )
  }

  const templateName =
    kind === 'liquid'
      ? (options.template ?? LIQUID_DEFAULT_TEMPLATE)
      : resolveTemplateName(options.space, options.template)
  const nameError = validateTemplateName(kind)(templateName)
  if (nameError) fail(`${pc.red('--template')} 값이 규칙에 맞지 않습니다: ${nameError}`)

  const phaseOpt = options.phase ?? 'sandbox'
  if (!PHASES.includes(phaseOpt as Phase)) {
    fail(`--phase 값은 ${PHASES.join(' | ')} 중 하나여야 합니다.`)
  }

  return {
    kind,
    space: options.space,
    templateName,
    packageManager: (options.pm as 'npm' | 'pnpm') ?? 'npm',
    phase: phaseOpt as Phase,
    target: targetOpt as DesignTarget,
    appId: '',
    appKey: '',
    tenantId: '',
  }
}

/** 대화형 경로. 취소하면 그 자리에서 종료한다. */
async function answersFromPrompts(options: InitOptions): Promise<InitAnswers> {
  const target = (await p.select({
    message: '첫 번째 템플릿은 어느 플랫폼용인가요? (레포에 두 종류를 섞을 수 있습니다)',
    options: [
      { value: 'user', label: 'user (b.stage 유저 플랫폼)' },
      { value: 'admin', label: 'admin (b.stage 어드민 플랫폼)' },
    ],
    initialValue: options.target === 'admin' ? 'admin' : 'user',
  })) as DesignTarget
  if (p.isCancel(target)) cancelled()

  const kind = (await p.select({
    message: '어떤 방식으로 만들까요?',
    options: [
      { value: 'sdk', label: 'sdk', hint: 'React 컴포넌트 — 플랫폼 API·슬롯 위젯 가능' },
      {
        value: 'liquid',
        label: 'liquid',
        hint: 'liquid 템플릿 — 서버가 데이터를 넣어 렌더, 페이지만',
      },
    ],
    initialValue: resolveKind(options.kind),
  })) as ProjectKind
  if (p.isCancel(kind)) cancelled()

  const space = (await p.text({
    message: '템플릿을 적용할 Space ID를 입력해 주세요.',
    validate: validateSlug('Space ID는 필수입니다.'),
  })) as string
  if (p.isCancel(space)) cancelled()

  const phase = (await p.select({
    message: '템플릿을 배포할 환경을 선택해 주세요.',
    options: [
      { value: 'sandbox', label: 'sandbox', hint: '기본' },
      { value: 'real', label: 'real' },
      { value: 'dev', label: 'dev', hint: '사내 전용 — .env에 호스트·CF Access 자격증명 필요' },
      { value: 'qa', label: 'qa', hint: '사내 전용 — .env에 호스트·CF Access 자격증명 필요' },
    ],
    initialValue: 'sandbox',
  })) as Phase
  if (p.isCancel(phase)) cancelled()

  const templateName = (await p.text({
    message:
      kind === 'liquid'
        ? `첫 번째 템플릿 이름을 입력해 주세요. ${pc.dim(`(${LIQUID_NAME_HINT})`)}`
        : `첫 번째 템플릿 이름을 입력해 주세요. ${pc.dim(`(예: ${space}-hello — 하이픈 필수)`)}`,
    placeholder:
      kind === 'liquid' ? LIQUID_DEFAULT_TEMPLATE : resolveTemplateName(space, undefined),
    validate: validateTemplateName(kind),
  })) as string
  if (p.isCancel(templateName)) cancelled()

  const packageManager = (await p.select({
    message: '사용할 패키지 매니저를 선택해 주세요.',
    options: [
      { value: 'npm', label: 'npm' },
      { value: 'pnpm', label: 'pnpm' },
    ],
    initialValue: 'npm',
  })) as 'npm' | 'pnpm'
  if (p.isCancel(packageManager)) cancelled()

  const base = { kind, space, templateName, packageManager, phase, target }
  // liquid는 API 키를 쓰는 코드가 없다 — .env도 client.ts도 만들지 않으므로 묻지 않는다.
  if (kind === 'liquid') return { ...base, appId: '', appKey: '', tenantId: '' }
  return { ...base, ...(await promptCredentials(space)) }
}

/**
 * API 인증 설정(선택). 게이트웨이는 유저단 API만 열려 있어 어드민 템플릿은 아직 쓸 곳이 없지만,
 * 한 레포에 두 종류가 섞일 수 있으므로 target으로 가르지 않는다.
 */
async function promptCredentials(
  space: string,
): Promise<{ appId: string; appKey: string; tenantId: string }> {
  const empty = { appId: '', appKey: '', tenantId: '' }

  const configureAuth = await p.confirm({
    message: 'b.stage 파트너스에서 발급받은 API 키가 있으신가요? (없어도 시작할 수 있어요)',
    initialValue: false,
  })
  if (p.isCancel(configureAuth)) cancelled()
  if (!configureAuth) return empty

  p.log.info(pc.dim('API 인증 설정 (선택)'))

  const appId = ((await p.text({
    message: '파트너 콘솔에서 발급받은 APP-ID를 입력해 주세요.',
  })) ?? '') as string
  if (p.isCancel(appId)) cancelled()

  const appKey = ((await p.text({
    message: '파트너 콘솔에서 발급받은 APP KEY를 입력해 주세요.',
  })) ?? '') as string
  if (p.isCancel(appKey)) cancelled()

  // APP-ID(bsa_)와 APP KEY(bsp_)를 반대로 입력한 경우 경고 — 입력은 막지 않는다.
  warnIfCredentialsSwapped(appId, appKey)

  return { appId, appKey, tenantId: space }
}

/**
 * `bstage init`의 입력 수집. `--yes`면 옵션에서, 아니면 대화형 프롬프트에서 채운다.
 * 어느 쪽이든 잘못된 값·취소는 여기서 프로세스를 끝내므로, 호출부는 성공 경로만 다룬다.
 */
export async function collectInitAnswers(options: InitOptions): Promise<InitAnswers> {
  return options.yes ? answersFromOptions(options) : answersFromPrompts(options)
}
