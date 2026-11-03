interface LiquidReadmeOptions {
  projectName: string
  /** 첫 템플릿이 놓인 대상 화면(user=사용자 화면 / admin=운영자 화면) */
  target: 'user' | 'admin'
  /** 첫 템플릿 폴더 이름 */
  name: string
}

/**
 * liquid 프로젝트 README. 규약(경로 깊이·이름 규칙)이 깨지면 빌더가 템플릿을 조용히 무시하므로,
 * 그 세 줄을 맨 앞에 둔다. 상세 절차는 AGENTS.md·스킬이 소유한다 — 여기서 중복하지 않는다.
 */
export function liquidReadme({ projectName, target, name }: LiquidReadmeOptions): string {
  return `# ${projectName}

b.stage liquid 템플릿 프로젝트. \`.liquid\` 파일을 작성하면 플랫폼이 서버에서 데이터를 넣어 렌더합니다.

## 구조

\`\`\`
public/${target}/${name}/
  template.liquid   — 템플릿 본문 (파일명 고정)
  data.json         — 로컬 미리보기용 샘플 데이터 (빌드에는 들어가지 않음)
\`\`\`

## 명령

- \`npm run dev\` — 로컬 미리보기 (\`bstage dev\`)
- \`npm run build\` — 구조·문법 검증 (번들을 만들지 않습니다)
- \`npm run deploy\` — b.stage kit 콘솔에서 빌드해 업데이트 (\`bstage deploy\`). 콘솔 화면에서도 할 수 있습니다

## 규칙

- 경로는 \`public/{user|admin}/{name}/template.liquid\` 한 깊이로 고정입니다 — 다른 위치의 파일은 무시됩니다.
- \`{name}\`은 소문자·숫자·하이픈만 쓰고, 폴더 하나가 페이지 하나입니다.
- 한 레포에 liquid와 React 템플릿(\`src/**/template.tsx\`)을 함께 둘 수 있습니다(혼합 레포). 단 sdk 페이지 폴더 이름에 \`user\`·\`admin\`을 쓰지 마세요(\`src/pages/user\` 등) — liquid 빌드 자리와 겹쳐 \`bstage build\`가 막습니다. 자세한 내용은 SDK 문서 LIQUID.md §8을 참고하세요.

작성 규약과 작업 절차는 \`AGENTS.md\`와 \`.claude/skills/\`의 스킬을 참고하세요.
`
}
