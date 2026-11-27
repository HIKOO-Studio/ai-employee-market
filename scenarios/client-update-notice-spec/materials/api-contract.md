# 服务端市场查新接口契约

## Endpoint
`POST /api/market/check-updates`

## Request Body
```json
{
  "channel": "beta",
  "installed": [
    { "id": "skills/copywriting-basics", "version": "1.0.0" },
    { "id": "judges/default-judge", "version": "1.2.0" }
  ]
}
```
- `channel`: `"beta" | "stable"`，必须与当前客户端构建渠道一致（由 `app-config.json` 决定；若未显式声明 `channel`，当 `version` 含预发布标识如 `-beta.` 时默认使用 `"beta"`，否则 `"stable"`）。

## Response Body (200 OK)
```json
{
  "updates": [
    {
      "id": "skills/copywriting-basics",
      "name": "文案基础技能",
      "from_version": "1.0.0",
      "to_version": "1.1.0",
      "used_by_projects": ["内容运营"]
    }
  ],
  "rollbacks": [
    {
      "id": "judges/default-judge",
      "name": "官方默认裁判",
      "from_version": "1.2.0",
      "to_version": "1.1.0",
      "reason": "1.2.0 与当前桌面端存在兼容缺陷，上游已紧急回退",
      "used_by_projects": []
    }
  ]
}
```

### 字段说明
- `updates`：常规上游新版本。
- `rollbacks`：**上游紧急回退/撤回记录**（优先级高于常规更新，通常用于召回存在缺陷的版本）。客户端启动提醒必须覆盖 `rollbacks`，并在展示文案中与常规更新明确区分（如标明「上游已回退」及目标版本），避免用户继续使用被召回版本。
