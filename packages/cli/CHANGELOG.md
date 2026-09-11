# @bstage-sdk/cli

## 0.2.0

- 포털 명령 추가: `bstage login`(브라우저 승인 코드 방식) · `logout` · `whoami` · `link` · `list` · `logs` · `deploy` · `rollback` · `publish`. 포털에서 발급한 개인 토큰으로 인증하며, 토큰은 포털 주소·조직별로 사용자 설정 디렉터리에 저장된다. 자세한 사용법은 `docs/GETTING_STARTED.md` 9절.
- CI 용도로 `BSTAGE_TOKEN` 환경변수와 `--json`/`--yes` 옵션을 지원한다.

