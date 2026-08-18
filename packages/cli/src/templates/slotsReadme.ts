/**
 * `src/slots/README.md` 스캐폴딩.
 *
 * 빈 디렉토리는 git이 추적하지 않는다 — 아무것도 안 넣으면 커밋·클론 뒤에 `src/slots/`가
 * 사라진다. `.gitkeep` 대신 안내 문서를 두어 자리를 지키면서 사용법도 함께 남긴다.
 */
export function slotsReadme(): string {
  return `# src/slots

플랫폼 화면 사이에 끼워 넣는 **위젯**을 두는 곳입니다.
페이지 전체를 그리는 템플릿은 \`src/pages/\`에 둡니다.

## 위젯 추가하기

폴더를 만들고 그 안에 \`template.tsx\`를 둡니다.

\`\`\`
src/slots/
  curation-banner/
    template.tsx
\`\`\`

\`\`\`tsx
import { createTemplate } from '@bstage-sdk/react'

export default function CurationBanner() {
  return <div>배너</div>
}

createTemplate(CurationBanner, {
  name: 'bmf-curation-banner',
  slot: 'user.contents-home.curation:after',
})
\`\`\`

## 폴더 이름은 자유입니다

어느 자리에 붙을지는 **\`slot\` 옵션만** 정합니다. 폴더 이름은 사람이 알아보기 쉬우면 됩니다.
빌드 산출물은 슬롯 id를 따라 \`dist/user.contents-home.curation--after/template.js\`로 나갑니다
(콜론은 Windows에서 폴더 이름에 쓸 수 없어 \`--\`로 바뀝니다).

\`src/pages/\`와 달리 폴더 구조는 배포 위치에 영향을 주지 않으므로, 원하는 만큼 중첩해도 됩니다.

## 쓸 수 있는 자리 목록

\`slot\`에 넣을 수 있는 값은 편집기 자동완성으로 확인할 수 있습니다.
전체 목록과 각 자리가 넘겨주는 context는 SDK 문서를 보세요.

\`\`\`bash
npx bstage docs   # SLOT_CATALOG_V2.md
\`\`\`

오타가 있으면 \`bstage build\`가 후보와 함께 막아줍니다.
`
}
