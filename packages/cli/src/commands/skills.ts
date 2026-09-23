import pc from 'picocolors'
import { aiInstallCommand } from './ai.js'

export interface SkillsInstallOptions {
  dir: string
}

/**
 * `bstage skills install` — `bstage ai install`의 deprecated 별칭.
 *
 * 스킬만이 아니라 AGENTS.md·CLAUDE.md·가드 훅까지 다루게 되면서 이름이 맞지 않게 됐다.
 * 기존 사용자의 손·CI가 깨지지 않도록 별칭만 남기고, 실제 동작은 `ai install`이 한다.
 */
export async function skillsInstallCommand(options: SkillsInstallOptions): Promise<void> {
  console.warn(
    pc.yellow(
      'bstage skills install은 bstage ai install로 바뀌었습니다. 다음 릴리즈에서 제거됩니다.',
    ),
  )
  await aiInstallCommand({ dir: options.dir })
}
