interface ReadmeOptions {
  projectName: string
  packageManager: 'npm' | 'pnpm'
}

export function readme({ projectName, packageManager }: ReadmeOptions): string {
  const runCmd = packageManager === 'pnpm' ? 'pnpm' : 'npm run'

  return `# ${projectName}

b.stage 서드파티 템플릿 프로젝트

## 시작하기

\`\`\`bash
${runCmd} dev
\`\`\`

개발 서버가 실행되면 http://localhost:5173 에서 템플릿 목록을 확인할 수 있습니다.

## 템플릿 추가

페이지냐 위젯이냐에 따라 두는 곳이 다릅니다. 파일명은 반드시 \`template.tsx\`여야 합니다.

- **페이지** — \`src/pages/{경로}/template.tsx\`. 폴더 구조가 곧 배포 경로가 됩니다.
- **위젯** — \`src/slots/{아무 이름}/template.tsx\`. 어느 자리에 붙을지는 \`createTemplate\`의 \`slot\` 옵션이 정합니다.

\`name\`은 Custom Element 태그로 그대로 사용되므로 **소문자로 시작하고 하이픈을 1개 이상 포함**해야 합니다. 예: \`my-widget\`, \`bmf-hello\`.

\`\`\`
src/pages/my-page/template.tsx        → /my-page
src/slots/my-widget/template.tsx      → slot 옵션이 자리를 정함
\`\`\`

\`\`\`tsx
import { createTemplate } from '@bstage-sdk/react'

export default function MyWidget() {
  return <div>Hello!</div>
}

createTemplate(MyWidget, {
  name: 'my-widget',
})
\`\`\`

## 환경 설정

\`.env\` 파일에서 API 환경을 변경할 수 있습니다.

\`\`\`
VITE_BSTAGE_PHASE=dev   # dev | qa | real | sandbox
\`\`\`

API 키(APP-ID/Secret)는 \`.env\`에서 설정합니다. \`.env\`는 커밋되지 않으니, clone 후 \`.env.example\`을 \`.env\`로 복사해 값을 채우세요.

> **보안**: 앱키 값을 소스 코드(예: \`client.ts\`)에 직접 넣지 마세요 — 반드시 \`.env\`로만 주입합니다. \`bstage init\`이 설치한 pre-commit 훅이 커밋 전 키 리터럴을 차단하며, \`--no-verify\`로 우회하지 마세요.

## SDK 업데이트

이 프로젝트는 생성 시점의 SDK 버전에 고정됩니다. 최신으로 올리려면 \`npx @bstage-sdk/cli@latest doctor\`로 진단한 뒤, Claude Code에 "bstage 최신 버전으로 마이그레이션 해줘"라고 요청하면 \`bstage-migrate\` 스킬이 처리합니다.

## 배포

배포는 관리도구에서 이 레포의 GitHub Actions 워크플로우를 트리거해 진행됩니다. 개발자는 코드 작성·push에 집중하면 되고, 배포 트리거는 관리도구에서 수행합니다.
`
}
