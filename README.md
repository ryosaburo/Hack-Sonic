# 宇宙釣りゲーム (space-fishing)

天の川で天体を釣り上げ、「魚拓」として図鑑に収集していくWebゲーム。
設計の詳細は [`space_fishing_game_spec.md`](./space_fishing_game_spec.md) を参照。

## 構成

```
.
├── frontend/   # React + TypeScript + Vite + Zustand
├── backend/    # FastAPI + SQLModel (SQLite)
└── space_fishing_game_spec.md
```

## 実装済み(MVP)

- 待機→キャスト→アタリ待ち→巻き上げ(体力ゲージ制)→成功/失敗 の状態遷移
- レア度別の連打/長押しパラメータ・フェーズ切替・予告演出
- Web Audio APIによる音響フィードバック、Canvas2Dによる竿・ライン・カメラ演出(spring/trauma shake/パララックス)
- 新種判定つきの魚拓演出(4ステップ)と図鑑UI(一覧・フィルタ・詳細モーダル・再生)
- FastAPIバックエンド: `/api/catalog`, `/api/collection`, `/api/cast/start`, `/api/cast/resolve`
- バックエンド未起動時はモックカタログ(`frontend/src/data/catalog.mock.json`)にフォールバック

## 未実装 / 今後の課題

仕様書15章を参照。特に、天体の実写画像は現状すべてプレースホルダー(生成SVG)。
実際のJAXA探査機画像に差し替える際は仕様書3章の著作権注意点を確認すること。

## 開発の始め方

### フロントエンド

```bash
cd frontend
npm install
npm run dev   # http://localhost:5173
```

### バックエンド

```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload   # http://localhost:8000 (Swagger: /docs)
```

`backend/.env` の `DATABASE_URL` で接続先DBを切り替える(開発中はSQLite)。
