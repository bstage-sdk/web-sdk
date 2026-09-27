interface LiquidTemplateOptions {
  /** `public/{target}/{name}/` 의 name — 페이지 하나에 해당하는 폴더 이름 */
  name: string
  /** 유저 화면인지 어드민인지 — 데이터 계약이 확인된 쪽만 예시를 넣는다. */
  target: 'user' | 'admin'
}

/**
 * 첫 `template.liquid` 본문. 값은 전부 플랫폼이 넣고 **실제 데이터에는 빈 목록이 자주 온다** —
 * 그래서 빈 목록 분기(`{% if %}`~`{% else %}`)를 기본형으로 보여 준다(샘플 `data.json`은 로컬
 * 미리보기에서만 쓰인다).
 */
export function liquidTemplate({ name, target }: LiquidTemplateOptions): string {
  const body =
    target === 'admin'
      ? `    <h1>${name}</h1>

    <!-- 어드민 화면에 플랫폼이 어떤 값을 넣는지는 확인되지 않았다. 값이 온다고 가정하지 말고
         첫 배포에서 실제 렌더를 보고 이름을 확인한 뒤 채운다. -->
    <p>여기에 내용을 작성하세요.</p>`
      : `    <h1>${name}</h1>

    <!-- 값은 플랫폼이 넣는다. 최상위 이름은 lounges · stories · contentSections ·
         latestContents · shopCategories 다섯 개뿐이고, 그 밖의 이름은 빈 문자열이 된다.
         항목 안의 필드(아래 section.title 등)는 계약이 아니라 예시다 — 실제 렌더 결과로
         확인한다. 빈 목록 분기를 함께 둔다. -->
    {% if contentSections.size > 0 %}
    <ul>
      {% for section in contentSections %}<li>{{ section.title }}</li>{% endfor %}
    </ul>
    {% else %}
    <p>표시할 항목이 없습니다.</p>
    {% endif %}`

  return `<!doctype html>
<html lang="ko">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${name}</title>
    <style>
      body { margin: 0; padding: 48px 24px; font-family: system-ui, sans-serif; line-height: 1.6; }
      h1 { margin: 0 0 12px; font-size: 28px; }
      p { margin: 0; color: #555; }
    </style>
  </head>
  <body>
${body}

    <!-- 이미지는 포털 화면의 스테이지 > 미디어에 올리고 발급된 URL을 절대 주소로 넣는다.
         레포에 두고 상대 경로로 참조하면 배포 후 깨진다(로컬 프리뷰에서는 보인다). -->
  </body>
</html>
`
}
