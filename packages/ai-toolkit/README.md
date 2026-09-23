# @bstage-sdk/ai-toolkit

에이전트(Claude Code·Codex·Cursor 등)가 b.stage 템플릿 프로젝트에서 일할 때 읽는 자산을 담는다 —
`AGENTS.md` 본문, `CLAUDE.md` 포인터, `.claude/skills/*/SKILL.md` 스킬 본문과 그 설치 계획
(`planInstall`)을 문자열로 제공한다. 프로세스도 네트워크도 파일 I/O도 없는 순수 콘텐츠 패키지이며,
실제로 파일을 쓰는 일은 이 패키지를 소비하는 CLI가 한다.

**직접 설치하지 않는다.** `@bstage-sdk/cli`가 의존하며, 소비자는
`bstage ai install` · `bstage ai update` · `bstage ai doctor`로 이 자산을 쓴다.

설치되는 파일·갱신 규칙·kind(sdk·liquid)별 스킬 세트는 SDK 문서 `docs/AI_TOOLKIT.md`가 다룬다
(`@bstage-sdk/core` 패키지에 함께 배포된다).
