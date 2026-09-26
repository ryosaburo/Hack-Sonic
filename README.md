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

- 起動時の発射場と約10秒の出発演出（打ち上げ→船内→宇宙到着→ハッチ・釣りデッキ展開）。初回は「出発する」、到着済みのブラウザでは「演出をスキップして釣りへ」も選択可能
- 待機→キャスト→アタリ待ち→巻き上げ(体力ゲージ制)→成功/失敗 の状態遷移
- レア度別の連打/長押しパラメータ・フェーズ切替・予告演出
- Web Audio APIによる音響フィードバック、Canvas2Dによる竿・ライン・カメラ演出(spring/trauma shake/パララックス)
- 新種判定つきの魚拓演出(4ステップ)と図鑑UI(一覧・フィルタ・詳細モーダル・再生)
- FastAPIバックエンド: `/api/catalog`, `/api/collection`, `/api/cast/start`, `/api/cast/resolve`
- バックエンド未起動時はモックカタログ(`frontend/src/data/catalog.mock.json`)にフォールバック
- 既知の釣果へのポイント報酬、交換所、消耗品の誘引ルアー、永久装備の星時計・強化リール
- 釣り場情報の購入と座標範囲表示、ルアー・釣り場によるレア度抽選の補正

## ポイント・交換の設定

待機画面左上の「交換所」から購入できます。誘引ルアーはチェックを入れた次の1投で消費され、永久装備は購入後に自動で効果が適用されます。釣り場情報は購入すると座標を確認でき、海に戻ると範囲が表示されます。

報酬は既存の `backend/app/data/catalog.json` の各項目に `"point": 20` のような0以上の整数を設定します。具体的な値はカタログ担当が決定します。**未設定の項目は0 ptです。現時点のカタログには値がないため、ポイント獲得による交換には値の設定が必要です。** API再起動時に既存DBの値も更新し、収集記録や残高は保持します。モック用の `frontend/src/data/catalog.mock.json` にも同じ値を反映してください。

交換価格・効果量は `backend/app/data/shop.json` と `frontend/src/data/shop.mock.json` にあります。現在の仮価格はルアー100 pt、星時計120 pt、強化リール100 pt、釣り場情報150 pt。読込側のTODOに従い、報酬決定後に両ファイルを同期して調整します。JSONにはコメントを追加しません。

通信結果が不明になった場合は「結果を再確認する」で同じ操作を再送します。再読込後も二重購入・二重報酬を防ぎます。モックでの残高と図鑑はローカル保存され、オンラインの残高には合算されません。

### テスト用の初期ポイント

カタログの `point` が設定される前でも交換所を試せます。バックエンドを使う場合は、通常の起動コマンドの前にテスト用設定を付けます。

```bash
cd backend
SPACE_FISHING_TEST_POINTS=500 .venv/bin/python -m uvicorn app.main:app --reload
```

ブラウザでゲームを開くと、その匿名プレイヤーの残高に **500 ptを1回だけ加算**します。既存プレイヤーにも適用されます。リロード・再起動や購入後の再表示では加算し直しません。設定を外せば通常の挙動に戻ります。値は0〜1000000の整数にしてください。設定を変更したらサーバーを再起動してください。

バックエンドを起動せずにモックで試す場合は、フロントエンドに別の設定を使います。

```bash
cd frontend
VITE_TEST_POINTS=500 npm run dev
```

モックも同じブラウザでは1回だけ加算し、ローカル保存します。Viteの設定を変更した場合は開発サーバーを再起動してください。バックエンドとフロントエンドの両方を起動している場合、残高はバックエンド側の設定で決まります。

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
