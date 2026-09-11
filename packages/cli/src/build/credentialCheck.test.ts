import { describe, expect, it } from 'vitest'
import {
  CREDENTIAL_ENV_VARS,
  checkCredentials,
  collectReferencedVars,
  isPlaceholderValue,
  usesBstageClient,
} from './credentialCheck.js'

/**
 * 이 점검은 소비자에게 "배포해도 된다"를 말하는 자리다. 오탐이 나면(UI 전용 템플릿이나
 * 리터럴 키를 쓰는 옛 프로젝트에 경고) 다음부터 아무도 안 읽고, 미탐이 나면(빈 값을 통과)
 * 있으나 마나다. 양쪽 다 손 검증으로는 빌드를 돌려봐야 알 수 있어서 테스트로 고정한다.
 */

/** 정상 통과하는 값 한 벌(현행 스캐폴드 — `VITE_BSTAGE_APP_KEY`). */
const VALID = {
  VITE_BSTAGE_APP_ID: 'bsa_abcdef0123456789',
  VITE_BSTAGE_APP_KEY: 'bsp_abcdef0123456789',
  VITE_BSTAGE_TENANT_ID: 'my-space',
}

/** 현행 스캐폴드처럼 세 값을 모두 env로 주입하는 프로젝트. */
const ALL_REFERENCED = new Set<string>([
  'VITE_BSTAGE_APP_ID',
  'VITE_BSTAGE_APP_KEY',
  'VITE_BSTAGE_TENANT_ID',
])

/** 이름 정리 전 스캐폴드 — 앱 키를 `VITE_BSTAGE_APP_SECRET`이라는 옛 이름으로 읽는 기존 프로젝트. */
const LEGACY_REFERENCED = new Set<string>([
  'VITE_BSTAGE_APP_ID',
  'VITE_BSTAGE_APP_SECRET',
  'VITE_BSTAGE_TENANT_ID',
])

describe('usesBstageClient', () => {
  it('번들에 앱 ID 헤더가 있으면 BstageClient를 쓰는 것으로 본다', () => {
    const bundle = Buffer.from(
      'var h={"Content-Type":"application/json","X-BSTAGE-APP-ID":"bsa_x"}',
    )
    expect(usesBstageClient(bundle)).toBe(true)
  })

  it('API를 쓰지 않는 UI 전용 번들은 대상이 아니다', () => {
    // client.ts를 스캐폴드만 하고 import하지 않으면 트리셰이킹으로 사라진다.
    const bundle = Buffer.from('customElements.define("bmf-hello",class extends HTMLElement{})')
    expect(usesBstageClient(bundle)).toBe(false)
  })
})

describe('isPlaceholderValue', () => {
  it.each(['YOUR_APP_ID', 'your-app-secret', 'xxx', 'example-tenant', 'PLACEHOLDER'])(
    '%s는 자리표시자다',
    (value) => {
      expect(isPlaceholderValue(value)).toBe(true)
    },
  )

  it.each(['bsa_abcdef0123456789', 'bsp_abcdef0123456789', 'my-space'])(
    '%s는 실제 값이다',
    (value) => {
      expect(isPlaceholderValue(value)).toBe(false)
    },
  )
})

describe('collectReferencedVars', () => {
  it('import.meta.env 참조를 찾는다', () => {
    const client = `export const client = new BstageClient({
      appId: import.meta.env.VITE_BSTAGE_APP_ID,
      appKey: import.meta.env.VITE_BSTAGE_APP_KEY,
      tenantId: import.meta.env.VITE_BSTAGE_TENANT_ID,
    })`
    expect(collectReferencedVars([client])).toEqual(ALL_REFERENCED)
  })

  it('옛 이름(VITE_BSTAGE_APP_SECRET)으로 읽는 기존 프로젝트의 참조도 찾는다', () => {
    const client = `export const client = new BstageClient({
      appId: import.meta.env.VITE_BSTAGE_APP_ID,
      appSecret: import.meta.env.VITE_BSTAGE_APP_SECRET,
      tenantId: import.meta.env.VITE_BSTAGE_TENANT_ID,
    })`
    expect(collectReferencedVars([client])).toEqual(LEGACY_REFERENCED)
  })

  it('cli 0.40.1 이전 스캐폴드처럼 키를 리터럴로 박은 소스는 참조가 없다', () => {
    // 이 전환은 마이그레이션에서 `선택`이라 옛 프로젝트는 .env가 없는 게 정상이다.
    const legacyClient = `export const client = new BstageClient({
      appId: 'bsa_abcdef0123456789',
      appSecret: 'bsp_abcdef0123456789',
      tenantId: 'my-space',
    })`
    expect(collectReferencedVars([legacyClient]).size).toBe(0)
  })

  it('변수 이름만 나오는 문맥(주석·문서)은 참조로 치지 않는다', () => {
    const notAReference = `// VITE_BSTAGE_APP_ID를 .env에 넣으세요
      const doc = 'VITE_BSTAGE_APP_SECRET'`
    expect(collectReferencedVars([notAReference]).size).toBe(0)
  })
})

describe('checkCredentials', () => {
  it('세 값이 온전하면 아무것도 보고하지 않는다', () => {
    expect(checkCredentials(VALID, ALL_REFERENCED)).toEqual([])
  })

  it.each([...ALL_REFERENCED])('%s가 없으면 오류 — 번들에 undefined가 박힌다', (varName) => {
    const issues = checkCredentials({ ...VALID, [varName]: undefined }, ALL_REFERENCED)
    expect(issues).toHaveLength(1)
    expect(issues[0]).toMatchObject({ level: 'error', varName })
  })

  it('CREDENTIAL_ENV_VARS는 새 이름과 옛 이름을 모두 참조 후보로 둔다', () => {
    expect(CREDENTIAL_ENV_VARS).toContain('VITE_BSTAGE_APP_KEY')
    expect(CREDENTIAL_ENV_VARS).toContain('VITE_BSTAGE_APP_SECRET')
  })

  // 앱 키는 이름이 둘(새 `APP_KEY`·옛 `APP_SECRET`)이지만 값은 하나다. 소스가 어느 이름으로 읽든
  // .env에 어느 이름으로 있든 빌드가 이어 붙이므로(env 별칭), 점검도 한 쌍으로 본다.
  it('소스는 APP_KEY를 읽는데 .env에는 옛 이름 APP_SECRET만 있어도 통과한다', () => {
    const env = {
      ...VALID,
      VITE_BSTAGE_APP_KEY: undefined,
      VITE_BSTAGE_APP_SECRET: 'bsp_abcdef0123456789',
    }
    expect(checkCredentials(env, ALL_REFERENCED)).toEqual([])
  })

  it('기존 프로젝트(소스는 APP_SECRET)에 포털이 새 이름 APP_KEY만 넣어 줘도 통과한다', () => {
    expect(checkCredentials(VALID, LEGACY_REFERENCED)).toEqual([])
  })

  // 별칭(appKeyEnvDefine)은 소스가 읽는 이름이 **비었을 때만** 다른 이름을 채운다. 두 이름이 다 있으면
  // 번들에는 소스가 읽는 이름의 값이 실린다 — 점검도 같은 값을 봐야 한다. 새 이름을 무조건 우선하면
  // 옛 client.ts 프로젝트에 새 이름이 함께 들어온 순간 자리표시자·뒤바뀜이 통과해 배포 뒤 401만 남는다.
  it('기존 프로젝트(소스는 APP_SECRET)에 두 이름이 다 있으면 소스가 읽는 옛 이름의 값을 점검한다 — 자리표시자', () => {
    const env = { ...VALID, VITE_BSTAGE_APP_SECRET: 'YOUR_APP_SECRET' }
    expect(checkCredentials(env, LEGACY_REFERENCED)).toMatchObject([
      { level: 'error', varName: 'VITE_BSTAGE_APP_SECRET' },
    ])
  })

  it('기존 프로젝트에 두 이름이 다 있으면 소스가 읽는 옛 이름의 값으로 뒤바뀜을 잡는다', () => {
    const env = { ...VALID, VITE_BSTAGE_APP_SECRET: 'bsa_swapped0123456789' }
    const issues = checkCredentials(env, LEGACY_REFERENCED)
    expect(issues).toHaveLength(1)
    expect(issues[0].message).toContain('바뀐')
  })

  it('기존 프로젝트에 두 이름이 다 있으면 안 읽는 새 이름의 접두사는 따지지 않는다', () => {
    const env = {
      ...VALID,
      VITE_BSTAGE_APP_KEY: 'key-weird',
      VITE_BSTAGE_APP_SECRET: 'bsp_abcdef0123456789',
    }
    expect(checkCredentials(env, LEGACY_REFERENCED)).toEqual([])
  })

  it('소스가 두 이름을 다 읽으면(마이그레이션 도중) 각 이름의 값을 따로 점검한다', () => {
    const referenced = new Set([...ALL_REFERENCED, 'VITE_BSTAGE_APP_SECRET'])
    const env = { ...VALID, VITE_BSTAGE_APP_SECRET: 'YOUR_APP_SECRET' }
    expect(checkCredentials(env, referenced)).toMatchObject([
      { level: 'error', varName: 'VITE_BSTAGE_APP_SECRET' },
    ])
  })

  it('기존 프로젝트에서 두 이름이 다 비어 있으면 소스가 읽는 이름(APP_SECRET)으로 보고한다', () => {
    const issues = checkCredentials({ ...VALID, VITE_BSTAGE_APP_KEY: undefined }, LEGACY_REFERENCED)
    expect(issues).toMatchObject([{ level: 'error', varName: 'VITE_BSTAGE_APP_SECRET' }])
  })

  it('빈 문자열·공백만 있는 값도 없는 것으로 본다', () => {
    const issues = checkCredentials({ ...VALID, VITE_BSTAGE_TENANT_ID: '   ' }, ALL_REFERENCED)
    expect(issues).toMatchObject([{ level: 'error', varName: 'VITE_BSTAGE_TENANT_ID' }])
  })

  it('init이 심은 자리표시자가 남아 있으면 오류', () => {
    const issues = checkCredentials(
      {
        VITE_BSTAGE_APP_ID: 'YOUR_APP_ID',
        VITE_BSTAGE_APP_KEY: 'YOUR_APP_KEY',
        VITE_BSTAGE_TENANT_ID: 'YOUR_TENANT_ID',
      },
      ALL_REFERENCED,
    )
    expect(issues).toHaveLength(3)
    expect(issues.every((i) => i.level === 'error')).toBe(true)
  })

  it('APP_ID와 APP_KEY가 뒤바뀌면 오류로 잡고, 접두사 경고는 겹쳐 내지 않는다', () => {
    const issues = checkCredentials(
      {
        ...VALID,
        VITE_BSTAGE_APP_ID: VALID.VITE_BSTAGE_APP_KEY,
        VITE_BSTAGE_APP_KEY: VALID.VITE_BSTAGE_APP_ID,
      },
      ALL_REFERENCED,
    )
    expect(issues).toHaveLength(1)
    expect(issues[0].level).toBe('error')
    expect(issues[0].message).toContain('바뀐')
    expect(issues[0].message).toContain('APP_KEY')
  })

  it('옛 이름으로 읽는 프로젝트도 뒤바뀜을 잡는다', () => {
    const issues = checkCredentials(
      {
        VITE_BSTAGE_APP_ID: 'bsp_abcdef0123456789',
        VITE_BSTAGE_APP_SECRET: 'bsa_abcdef0123456789',
        VITE_BSTAGE_TENANT_ID: 'my-space',
      },
      LEGACY_REFERENCED,
    )
    expect(issues).toMatchObject([{ level: 'error' }])
    expect(issues[0].message).toContain('바뀐')
  })

  it('앱 키 접두사가 규약과 다르면 소스가 읽는 이름으로 경고한다', () => {
    const issues = checkCredentials({ ...VALID, VITE_BSTAGE_APP_KEY: 'key-12345' }, ALL_REFERENCED)
    expect(issues).toMatchObject([{ level: 'warn', varName: 'VITE_BSTAGE_APP_KEY' }])
  })

  it('접두사가 규약과 다르면 경고 — 오류는 아니다(옛 발급 값일 수 있다)', () => {
    const issues = checkCredentials({ ...VALID, VITE_BSTAGE_APP_ID: 'app-12345' }, ALL_REFERENCED)
    expect(issues).toMatchObject([{ level: 'warn', varName: 'VITE_BSTAGE_APP_ID' }])
  })

  it('tenantId는 형식 규약이 없어 값이 있으면 통과시킨다', () => {
    expect(
      checkCredentials({ ...VALID, VITE_BSTAGE_TENANT_ID: 'anything' }, ALL_REFERENCED),
    ).toEqual([])
  })

  it('소스가 참조하지 않는 변수는 검사하지 않는다 — 리터럴 키를 쓰는 옛 프로젝트 오탐 방지', () => {
    // .env가 통째로 없어도, 소스가 env를 읽지 않으면 번들에 영향이 없다.
    expect(checkCredentials({}, new Set())).toEqual([])
  })

  it('일부만 env로 주입해도 참조한 변수만 본다', () => {
    // tenantId만 env로 빼고 나머지는 리터럴로 둔 프로젝트.
    const referenced = new Set(['VITE_BSTAGE_TENANT_ID'])
    expect(checkCredentials({ VITE_BSTAGE_TENANT_ID: 'my-space' }, referenced)).toEqual([])
    expect(checkCredentials({}, referenced)).toMatchObject([
      { level: 'error', varName: 'VITE_BSTAGE_TENANT_ID' },
    ])
  })

  it('보고에 값 자체를 담지 않는다 — 빌드 로그에 시크릿을 남기지 않기 위해', () => {
    const secret = 'bsp_realsecretvalue0123'
    const issues = checkCredentials({ ...VALID, VITE_BSTAGE_APP_ID: secret }, ALL_REFERENCED)
    expect(issues.length).toBeGreaterThan(0)
    expect(JSON.stringify(issues)).not.toContain(secret)
  })
})
