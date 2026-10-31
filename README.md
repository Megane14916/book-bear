# book-bear

## 開発環境

Node.js 22.12以上とpnpm 10.28.2を使用します。

```sh
pnpm install
pnpm dev:api # http://localhost:8787
pnpm dev:web # http://localhost:5173
pnpm typecheck
pnpm build
```

WebのAPI接続先は `apps/web/.env.example` を参考に `apps/web/.env.local` の `VITE_API_BASE_URL` で変更できます。APIのCORS許可元は既定で `http://localhost:5173` です。環境ごとにWorkersの `CORS_ORIGIN` を設定してください。

## OpenAPI契約

`pnpm generate:openapi` はAPIのHono/Zod定義から `contracts/openapi.json` を生成し、続けてWeb用の型を生成します。生成物はコミットし、変更後は `pnpm check:openapi` で差分がないことを確認します。現在の生成契約に含まれるのは稼働確認用の `/api/v1/health` のみです。`contracts/openapi-draft.yaml` は未実装の機能を含む設計用ドラフトで、実装済みAPIの契約ではありません。
