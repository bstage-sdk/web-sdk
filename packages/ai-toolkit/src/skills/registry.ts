import { deploySkillMd } from './deploy.js'
import { liquidSkillMd } from './liquid.js'
import { migrateSkillMd } from './migrate.js'
import { onboardingSkillMd } from './onboarding.js'
import { withStamp } from './stamp.js'
import { templateSkillMd } from './template.js'

/**
 * 스킬이 설치되는 프로젝트 종류 — sdk 템플릿 프로젝트 / liquid 테마 프로젝트 / 혼합(둘 다 한 레포).
 * `mixed`는 판정 결과로만 나온다(`--kind`로 지정하는 값이 아니다) — 스킬 목록은 두 세트의 합집합이고
 * AGENTS.md는 혼합 본문이다. 각 스킬의 `kinds`에는 단일 종류만 적는다(mixed는 파생).
 */
export type ProjectKind = 'sdk' | 'liquid' | 'mixed'

/** 디자인 토큰 타깃 — 유저(유저 플랫폼) / 어드민(어드민 플랫폼) */
export type DesignTarget = 'user' | 'admin'

/** 스킬 본문을 렌더링할 때 넘기는 프로젝트 맥락 */
export interface SkillContext {
  kind: ProjectKind
  target: DesignTarget
}

/**
 * 에이전트용 스킬 자산. `bstage init`(새 프로젝트 스캐폴드)과
 * `bstage ai install`(기존 프로젝트 동기화)이 공유하는 단일 소스.
 *
 * 스킬을 추가하려면 여기에 한 줄 등록하면 두 경로 모두 자동 반영된다.
 */
export interface BstageSkill {
  /** `.claude/skills/<name>/SKILL.md` 디렉토리명 */
  name: string
  /** 이 스킬이 설치되는 프로젝트 종류 */
  kinds: ProjectKind[]
  /** SKILL.md 본문 */
  content: (ctx: SkillContext) => string
}

// 버전 스탬프는 여기서 공통으로 감싼다 — 각 본문이 잊지 않도록(설치본 staleness 판정의 근거).
export const BSTAGE_SKILLS: BstageSkill[] = [
  {
    name: 'bstage-onboarding',
    kinds: ['sdk', 'liquid'],
    content: () => withStamp(onboardingSkillMd()),
  },
  {
    name: 'bstage-template',
    kinds: ['sdk'],
    content: ({ target }) => withStamp(templateSkillMd(target)),
  },
  { name: 'bstage-liquid', kinds: ['liquid'], content: () => withStamp(liquidSkillMd()) },
  { name: 'bstage-deploy', kinds: ['sdk', 'liquid'], content: () => withStamp(deploySkillMd()) },
  { name: 'bstage-migrate', kinds: ['sdk', 'liquid'], content: () => withStamp(migrateSkillMd()) },
]

/**
 * 해당 프로젝트 종류에 설치할 스킬만 골라낸다. 혼합 레포는 sdk 세트와 liquid 세트의 합집합이다 —
 * React 템플릿과 liquid 템플릿을 둘 다 작성하므로 어느 한쪽 작성 스킬도 빠지면 안 된다.
 */
export function skillsFor(kind: ProjectKind): BstageSkill[] {
  const wanted: ProjectKind[] = kind === 'mixed' ? ['sdk', 'liquid'] : [kind]
  return BSTAGE_SKILLS.filter((s) => s.kinds.some((k) => wanted.includes(k)))
}
