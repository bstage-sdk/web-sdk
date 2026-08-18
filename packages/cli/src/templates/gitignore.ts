export function gitignore(): string {
  return `# Logs
logs
*.log
npm-debug.log*
yarn-debug.log*
yarn-error.log*
pnpm-debug.log*
lerna-debug.log*

node_modules
dist
dist-ssr
*.local

# 환경변수 (인증 정보 포함 — 커밋 금지). .env.example만 커밋한다.
# .env만 무시한다 — .env.local은 위 *.local이 처리하고, .env.development 등 Vite 모드
# 파일은 무시하지 않는다.
.env

# bstage 로컬 캐시 (번역 등 — bstage i18n pull로 재생성)
.bstage

# Editor directories and files
.vscode/*
!.vscode/extensions.json
.idea
.DS_Store
*.suo
*.ntvs*
*.njsproj
*.sln
*.sw?
`
}
