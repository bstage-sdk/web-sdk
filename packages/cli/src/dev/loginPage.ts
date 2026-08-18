import { AUTH_TOKEN_PATH_BY_MODE, AUTH_PATH_PREFIX, type AuthMode } from '../constants.js'

/**
 * bstage 로컬 개발용 최소 로그인 페이지 HTML.
 *
 * - 순수 HTML/CSS/JS, 프레임워크 의존 없음
 * - mode 에 따라 form action 경로가 달라진다:
 *   - user → /__auth__/account/api/v1/auth/token
 *   - admin → /__auth__/api/v1/auth/token
 * - 인증 프록시(devVitePlugin)가 요청 헤더 X-BSTAGE-TENANT-ID 와 mode 로
 *   업스트림 호스트/쿠키 이름을 분기한다
 * - Vite 프록시가 쿠키 속성을 제거하여 브라우저가 세션 쿠키를 자동 저장
 * - 응답 status 가 `TWO_FACTOR_NEEDED` 이면 OTP 입력 단계로 전환하고
 *   `/__auth__/api/v1/operators/two-factor/validate-and-register` 로 OTP 검증
 *   (백엔드는 1단계 응답과 함께 OTP 를 자동 발송함)
 */
export function getLoginPageHtml(phase: string, mode: AuthMode = 'user'): string {
  // AUTH_TOKEN_PATH_BY_MODE 는 `/svc/...` 형태이므로 `/svc` 를 `/__auth__` 로 치환한다
  const tokenPath = AUTH_TOKEN_PATH_BY_MODE[mode].replace(/^\/svc/, AUTH_PATH_PREFIX)
  // 2FA 검증 경로 — 어드민 흐름. user 모드도 같은 경로를 쓰는지 미확인이라 일단 admin 전용 흐름으로 유지
  const twoFactorVerifyPath = `${AUTH_PATH_PREFIX}/api/v1/operators/two-factor/validate-and-register`
  const modeLabel = mode === 'admin' ? 'admin' : 'user'
  const subtitle = mode === 'admin' ? '로컬 개발 환경 어드민 로그인' : '로컬 개발 환경 로그인'

  return /* html */ `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>bstage dev login (${modeLabel})</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }

    body {
      font-family: system-ui, sans-serif;
      display: flex;
      justify-content: center;
      min-height: 100vh;
      padding-top: 100px;
      color: #111;
    }

    .card {
      width: 100%;
      max-width: 380px;
      padding: 36px 32px;
      border: 1px solid #e5e5e5;
      border-radius: 12px;
      height: fit-content;
    }

    .header {
      margin-bottom: 28px;
    }

    .title {
      font-size: 18px;
      font-weight: 600;
    }

    .badge {
      display: inline-block;
      font-size: 11px;
      font-weight: 600;
      color: #fff;
      padding: 2px 8px;
      border-radius: 3px;
      margin-left: 6px;
      vertical-align: middle;
      text-transform: uppercase;
    }

    .badge.phase { background: #111; }
    .badge.mode-user { background: #06c; }
    .badge.mode-admin { background: #c60; }

    .subtitle {
      font-size: 14px;
      color: #999;
      margin-top: 6px;
    }

    form {
      display: flex;
      flex-direction: column;
      gap: 18px;
    }

    .field {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    label {
      font-size: 14px;
      font-weight: 500;
      color: #555;
    }

    input {
      width: 100%;
      padding: 12px 14px;
      font-size: 15px;
      border: 1px solid #e5e5e5;
      border-radius: 8px;
      outline: none;
      transition: border-color 0.15s;
    }
    input::placeholder { color: #ccc; }
    input:focus { border-color: #111; }

    button {
      width: 100%;
      padding: 12px;
      font-size: 15px;
      font-weight: 600;
      color: #fff;
      background: #111;
      border: none;
      border-radius: 8px;
      cursor: pointer;
      margin-top: 6px;
      transition: opacity 0.15s;
    }
    button:hover { opacity: 0.85; }
    button:disabled { opacity: 0.4; cursor: not-allowed; }

    .link {
      background: none;
      color: #06c;
      font-weight: 500;
      padding: 0;
      margin: 8px 0 0;
      width: auto;
      align-self: flex-start;
    }
    .link:hover { opacity: 0.7; }

    .error {
      color: #c00;
      font-size: 14px;
      display: none;
    }

    .info {
      font-size: 13px;
      color: #666;
      line-height: 1.5;
      padding: 10px 12px;
      background: #f5f7fa;
      border-radius: 6px;
    }

    .success {
      text-align: center;
      padding: 24px 0;
      font-size: 15px;
      color: #666;
    }

    .hidden { display: none; }
  </style>
</head>
<body>
  <div class="card">
    <div class="header">
      <div class="title">
        b.stage
        <span class="badge phase">${phase}</span>
        <span class="badge mode-${mode}">${modeLabel}</span>
      </div>
      <div class="subtitle">${subtitle}</div>
    </div>

    <form id="loginForm">
      <div class="field">
        <label for="tenantId">Space ID</label>
        <input id="tenantId" type="text" placeholder="e.g. bmf" autocomplete="off" required />
      </div>
      <div class="field">
        <label for="email">Email</label>
        <input id="email" type="email" placeholder="you@example.com" autocomplete="email" required />
      </div>
      <div class="field">
        <label for="password">Password</label>
        <input id="password" type="password" placeholder="password" autocomplete="current-password" required />
      </div>
      <div id="error" class="error"></div>
      <button type="submit">Login</button>
    </form>

    <form id="otpForm" class="hidden">
      <div class="info">2단계 인증 — 등록된 수단으로 발송된 OTP 코드를 입력하세요.</div>
      <div class="field">
        <label for="otp">OTP</label>
        <input id="otp" type="text" inputmode="numeric" autocomplete="one-time-code" placeholder="6자리 코드" required />
      </div>
      <div id="otpError" class="error"></div>
      <button type="submit">Verify</button>
      <button type="button" class="link" id="otpBack">← 이메일/비밀번호 다시 입력</button>
    </form>

    <div id="success" class="success hidden">
      <p>Logged in — Redirecting...</p>
    </div>
  </div>

  <script>
    const loginForm = document.getElementById('loginForm');
    const otpForm = document.getElementById('otpForm');
    const errorEl = document.getElementById('error');
    const otpErrorEl = document.getElementById('otpError');
    const successEl = document.getElementById('success');
    const otpBackBtn = document.getElementById('otpBack');
    const TOKEN_PATH = ${JSON.stringify(tokenPath)};
    const TWO_FACTOR_VERIFY_PATH = ${JSON.stringify(twoFactorVerifyPath)};

    // 1단계에서 받은 값 — 2단계(OTP)에서 재사용
    let pending = null;

    function showError(el, msg) {
      el.textContent = msg;
      el.style.display = 'block';
    }
    function hideError(el) {
      el.style.display = 'none';
    }
    function setBusy(form, busy, label) {
      const btn = form.querySelector('button[type="submit"]');
      btn.disabled = busy;
      btn.textContent = busy ? label.busy : label.idle;
    }
    function finishSuccess() {
      loginForm.classList.add('hidden');
      otpForm.classList.add('hidden');
      successEl.classList.remove('hidden');
      setTimeout(() => { window.location.href = '/'; }, 1000);
    }

    loginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      hideError(errorEl);

      const tenantId = document.getElementById('tenantId').value;
      const email = document.getElementById('email').value;
      const password = document.getElementById('password').value;

      setBusy(loginForm, true, { idle: 'Login', busy: 'Logging in...' });

      try {
        const res = await fetch(TOKEN_PATH, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-BSTAGE-TENANT-ID': tenantId,
          },
          credentials: 'include',
          body: JSON.stringify({ email, password }),
        });

        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.message || 'Login failed (' + res.status + ')');
        }

        const data = await res.json().catch(() => ({}));

        // status === 'TWO_FACTOR_NEEDED' 면 OTP 단계로 전환.
        // 백엔드가 이 응답과 함께 OTP 를 자동 발송한다.
        if (data.status === 'TWO_FACTOR_NEEDED') {
          pending = { tenantId, email, password };
          loginForm.classList.add('hidden');
          otpForm.classList.remove('hidden');
          setBusy(loginForm, false, { idle: 'Login', busy: 'Logging in...' });
          document.getElementById('otp').focus();
          return;
        }

        if (data.status === 'PASSWORD_RESET_NEEDED') {
          throw new Error('비밀번호 재설정이 필요한 계정입니다. 어드민 웹에서 먼저 비밀번호를 갱신해 주세요.');
        }

        finishSuccess();
      } catch (err) {
        showError(errorEl, err.message);
        setBusy(loginForm, false, { idle: 'Login', busy: 'Logging in...' });
      }
    });

    otpForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      hideError(otpErrorEl);
      if (!pending) {
        showError(otpErrorEl, '세션이 만료되었습니다. 다시 로그인해 주세요.');
        return;
      }
      const otp = document.getElementById('otp').value;
      setBusy(otpForm, true, { idle: 'Verify', busy: 'Verifying...' });

      try {
        const res = await fetch(TWO_FACTOR_VERIFY_PATH, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-BSTAGE-TENANT-ID': pending.tenantId,
          },
          credentials: 'include',
          body: JSON.stringify({
            email: pending.email,
            password: pending.password,
            otp,
          }),
        });

        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.message || 'OTP 검증 실패 (' + res.status + ')');
        }

        finishSuccess();
      } catch (err) {
        showError(otpErrorEl, err.message);
        setBusy(otpForm, false, { idle: 'Verify', busy: 'Verifying...' });
      }
    });

    otpBackBtn.addEventListener('click', () => {
      pending = null;
      otpForm.classList.add('hidden');
      loginForm.classList.remove('hidden');
      hideError(otpErrorEl);
      document.getElementById('otp').value = '';
    });
  </script>
</body>
</html>`
}
