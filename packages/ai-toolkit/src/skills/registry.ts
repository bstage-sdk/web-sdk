import { deploySkillMd } from './deploy.js'
import { liquidSkillMd } from './liquid.js'
import { migrateSkillMd } from './migrate.js'
import { onboardingSkillMd } from './onboarding.js'
import { withStamp } from './stamp.js'
import { templateSkillMd } from './template.js'

/** 스킬이 설치되는 프로젝트 종류 — sdk 템플릿 프로젝트 / liquid 테마 프로젝트 */
export type ProjectKind = 'sdk' | 'liquid'

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

/** 해당 프로젝트 종류에 설치할 스킬만 골라낸다. */
export function skillsFor(kind: ProjectKind): BstageSkill[] {
  return BSTAGE_SKILLS.filter((s) => s.kinds.includes(kind))
}
