import { migrateSkillMd } from './migrateSkillMd.js'
import { templateSkillMd } from './templateSkillMd.js'
import type { DesignTarget } from './designGuide.js'

/**
 * 에이전트용 스킬 자산. `bstage init`(새 프로젝트 스캐폴드)과
 * `bstage skills install`(기존 프로젝트 동기화)이 공유하는 단일 소스.
 *
 * 스킬을 추가하려면 여기에 한 줄 등록하면 두 경로 모두 자동 반영된다.
 */
export interface BstageSkill {
  /** `.claude/skills/<name>/SKILL.md` 의 디렉토리명 */
  name: string
  /** SKILL.md 본문. `target`은 디자인 토큰 타깃(user/admin) — 디자인 섹션이 없는 스킬은 무시한다. */
  content: (target: DesignTarget) => string
}

export const BSTAGE_SKILLS: BstageSkill[] = [
  { name: 'bstage-migrate', content: migrateSkillMd },
  { name: 'bstage-template', content: templateSkillMd },
]
