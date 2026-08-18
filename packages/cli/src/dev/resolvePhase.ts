import { loadEnv } from 'vite'

/** SDK가 아는 phase 목록. 이 밖의 값은 오타로 본다. */
export const PHASES = ['dev', 'qa', 'real', 'sandbox'] as const
export type Phase = (typeof PHASES)[number]

/**
 * 기본 phase. `dev`·`qa`는 사내 전용이라 Cloudflare Access 게이트 뒤에 있어,
 * 아무 설정 없이 시작하는 사람이 게이트에 막히지 않도록 게이트가 없는 쪽을 기본으로 둔다.
 */
export const DEFAULT_PHASE: Phase = 'sandbox'

/** phase 값을 어디서 얻었는지 — 로그로 알려주기 위한 구분. */
export type PhaseSource = 'flag' | 'env' | 'default'

export interface ResolvedPhase {
  phase: Phase
  source: PhaseSource
  /** env에 있었지만 아는 phase가 아니라 무시한 값. 있으면 호출자가 경고한다. */
  ignoredEnvValue?: string
}

function isPhase(value: string): value is Phase {
  return (PHASES as readonly string[]).includes(value)
}

/**
 * 쓸 phase를 정한다. `--phase` 플래그 → 프로젝트 `.env`의 `VITE_BSTAGE_PHASE` → 기본값 순.
 *
 * env를 보는 이유: 스캐폴드가 `.env`에 phase를 적어두는데, CLI 기본값이 그걸 무시하면
 * 같은 프로젝트인데 `bstage dev`와 빌드 산출물이 서로 다른 환경을 가리키게 된다.
 * 유저·어드민 프로젝트가 같은 변수를 쓰므로 규칙이 하나다.
 *
 * 셸 환경변수를 `.env`보다 먼저 보는 것은 `bstage build`의 인증 값 점검과 같은 순서다(CI 주입 우선).
 */
export function resolvePhase(explicit: string | undefined, cwd = process.cwd()): ResolvedPhase {
  if (explicit) {
    if (!isPhase(explicit)) {
      throw new Error(
        `--phase 값은 ${PHASES.join(' | ')} 중 하나여야 합니다. (받은 값: ${explicit})`,
      )
    }
    return { phase: explicit, source: 'flag' }
  }

  const fileEnv = loadEnv('development', cwd, '')
  const fromEnv = process.env.VITE_BSTAGE_PHASE || fileEnv.VITE_BSTAGE_PHASE || ''
  if (fromEnv) {
    if (isPhase(fromEnv)) return { phase: fromEnv, source: 'env' }
    // 오타를 조용히 기본값으로 흘리면 엉뚱한 환경에 붙고도 모른다.
    return { phase: DEFAULT_PHASE, source: 'default', ignoredEnvValue: fromEnv }
  }

  return { phase: DEFAULT_PHASE, source: 'default' }
}

/** 해석 결과를 사람이 읽을 한 줄로. 어느 환경에 붙는지는 항상 보이는 편이 낫다. */
export function describePhase({ phase, source, ignoredEnvValue }: ResolvedPhase): string {
  if (ignoredEnvValue) {
    return `[bstage] VITE_BSTAGE_PHASE 값 "${ignoredEnvValue}"을(를) 알 수 없어 무시했습니다. phase: ${phase} (기본값)`
  }
  const label =
    source === 'flag' ? '--phase' : source === 'env' ? '.env의 VITE_BSTAGE_PHASE' : '기본값'
  return `[bstage] phase: ${phase} (${label})`
}
