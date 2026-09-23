export { VERSION } from './version.js'

export type { ProjectKind, DesignTarget, SkillContext, BstageSkill } from './skills/registry.js'
export { BSTAGE_SKILLS, skillsFor } from './skills/registry.js'
export { skillStamp, withStamp, readSkillStamp } from './skills/stamp.js'

export { agentsMd, agentsManagedBody, renderManagedBlock } from './agents/agentsMd.js'
export {
  AGENTS_MANAGED_VERSION,
  agentsMdStatus,
  swapManagedBlock,
  parseAgentsIdentity,
  readManagedVersion,
  wrapManaged,
  freeRegionScaffold,
} from './agents/agentsMdRegion.js'
export type { AgentsMdStatus } from './agents/agentsMdRegion.js'
export { claudeMd } from './agents/claudeMd.js'
export { sanitizeIdentity } from './agents/identity.js'

export { planInstall, skillFilePath } from './install/plan.js'
export type { InstallInput, InstallAction, ActionReason } from './install/plan.js'
export { designGuideSection, designRulesBrief, meta as designMeta } from './agents/designGuide.js'
