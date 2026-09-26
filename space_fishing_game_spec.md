# 宇宙釣りゲーム 設計まとめ

## 1. コンセプト

- テーマ：宇宙 → 星がいっぱい → 天の川
- 天の川で釣りをして、釣れるのは惑星・小惑星などの天体
- 釣れた天体は「魚拓」としてコレクションできる

## 2. JAXA APIの活用方針

- **JAXA Earth API**（`data.earth.jaxa.jp`）は地球観測衛星データ（雲・植生・夜間光など、地球を宇宙から見た画像）を提供するAPIであり、「天の川そのもの・深宇宙の恒星」を撮影したデータではない。
- そのため、以下の方針を採用：
  - **池・天の川の背景**：演出的な星空（自前で描画、実データは使わない）
  - **釣果（魚拓）の実写画像**：はやぶさ2・あかつき・SLIM等、JAXA探査機が実際に撮影した画像を使用
  - **JAXA Earth API**：タイトル画面やロード中の背景、特殊な「地球引き」演出など、補助的な演出用途として活用

## 3. 著作権に関する注意点

- JAXAの画像・映像は、JAXAデジタルアーカイブス上で学術研究・TV番組・出版物等への無償利用が許諾されており、それ以外の用途は有償許諾（申請）が必要。
- **かぐやのHDTV画像などNHKとの共同著作物**は、商業利用の場合はJAXAとは別にNHKへの申請が必要 → 初期カタログからは除外し、かぐやを使う場合は地形カメラ（TC）画像など JAXA単独著作のものを採用。
- 個人の非商用プロジェクト・ポートフォリオとして進め、収益化を検討する段階でJAXAへ利用許諾を別途確認する方針。
- 画像には常に `©JAXA` 等のクレジット表記を、魚拓演出後・図鑑詳細画面の両方で常時表示する。
- フレーバーテキストはJAXAの公式発表文の転載ではなく、事実を自分たちの言葉で要約したオリジナル文章にする。

## 4. カタログ設計

### スキーマ

| フィールド | 内容 |
|---|---|
| `id` | 一意ID |
| `body_name` | 対象天体名 |
| `mission_name` | 探査機・衛星名 |
| `image_url` | 画像の参照先URL（自前ストレージ） |
| `credit_text` | クレジット表記（例：©JAXA） |
| `rarity` | コモン／レア／スーパーレア／伝説 |
| `weight` | 抽選時の重み |
| `point` | 図鑑登録済みの対象を釣ったときの報酬（0以上の整数）。既存の `backend/app/data/catalog.json` で設定 |
| `capture_date` | 撮影日 |
| `flavor_text` | 図鑑用の説明文（独自文章） |
| `license_note` | 利用範囲メモ（社内確認用） |

### 天体候補（レア度別）

| レア度 | 天体・対象 | 探査機/衛星 | 備考 |
|---|---|---|---|
| コモン | イトカワ | はやぶさ（初号機） | JAXA単独著作 |
| コモン | リュウグウ（遠景） | はやぶさ2 | 到着直後の全体像 |
| レア | 金星の雲 | あかつき | UVI/IR画像 |
| レア | 月面（地形カメラ） | かぐや（TC画像） | HDTVではなくTC画像を採用 |
| スーパーレア | リュウグウ（タッチダウン痕跡） | はやぶさ2 | クレーター生成後の接写 |
| スーパーレア | 水星フライバイ画像 | みお（BepiColombo） | 画像元の確認要 |
| 伝説 | 「宇宙からの自撮り」 | IKAROS（分離カメラDCAM） | 太陽帆と地球を捉えた1枚 |
| 伝説 | 月面着陸の瞬間 | SLIM | SORA-Qが撮影 |
| 伝説 | 星雲・銀河 | あかり（AKARI） | 天の川テーマに直結 |

### 抽選確率

コモン70% ／ レア20% ／ スーパーレア8% ／ 伝説2%

## 5. 開発体制

- 2人体制、双方Macで開発
- **担当A**：フロントエンドの演出・インタラクション
- **担当B**：バックエンド・カタログDB・図鑑DB
- モックの `catalog.json` を先に固定し、担当Aはバックエンド完成前から演出を作り込める体制にする
- フィードバックは振動（Vibration API）ではなく音響＋画面演出を採用したため、Mac上のブラウザだけで実装から確認まで完結できる（実機デバッグの手間が不要になった）

## 6. 釣りインタラクション設計

### 起動時の出発演出（2026-09-26追加）

- 初回は地球の発射場で「出発する」を押し、約10秒（現在10.4秒）の演出を通して宇宙へ向かう。
- 到着まで再生した時点で、ブラウザのlocalStorageに到着済みを記録する。途中で閉じた場合は初回のまま。保存できない環境でも釣りに進めるが、次回は初回扱いになる。
- 2回目以降は発射場で「出発する」「演出をスキップして釣りへ」を選択できる。
- 白い外装、金属の内装、計器を備えたリアル寄りの宇宙船をCanvas 2Dで描画する。
- 流れは「発射場→外から打ち上げを追う→雲を挟んで船内視点→窓越しに宇宙へ→ハッチ開放・釣りデッキ展開→現在の釣り画面」。ロケットがそのまま釣り船となり、釣り中の視点・操作は維持する。
- 出発操作で音声を初期化し、打ち上げの低い振動音を宇宙到着時に収める。出発画面にミュート切り替えを設ける（出発演出の音だけが対象）。
- 描画はrequestAnimationFrameのdeltaTime基準。非表示タブでは進行と音を止め、再表示後に再開する。動きを減らすOS設定では振動とデッキへのカメラ前進を抑える。
- 演出中は釣り画面をマウントせず、出発操作による意図しないキャストを防ぐ。カタログは出発画面から先行して読み込む。

### 状態遷移

待機 → キャスト → アタリ待ち → 巻き上げミニゲーム → 成功 or 失敗（失敗は待機へループ）

### 入力方式

- PC：キーボード操作（Spaceキーなど）
- スマホ：画面タップ
- `window.matchMedia('(pointer: coarse)')` でデバイス判定し、ロジック側は共通の `onPressStart` / `onPressEnd` のみを扱う（Pointer Events APIで抽象化）

### 巻き上げの仕組み（ゲージ制）

- ラウンド制ではなく、魚の**体力ゲージ（0〜100）を連続的に削る**方式
- 何もしないと体力は少しずつ回復する
- フェーズ（連打／長押し）は一定間隔でランダムに切り替わる
- 制限時間内に体力を0にすれば成功、できなければ魚は逃げる

| レア度 | 連打1回の減少量 | 長押し減少速度(/秒) | 回復速度(/秒) | フェーズ切替間隔 | 制限時間 |
|---|---|---|---|---|---|
| コモン | 4 | 15 | 3 | 1.5〜2.5秒 | 20秒 |
| レア | 3 | 12 | 5 | 1.2〜2.0秒 | 17秒 |
| スーパーレア | 2.5 | 10 | 7 | 1.0〜1.6秒 | 14秒 |
| 伝説 | 2 | 8 | 9 | 0.7〜1.3秒 | 12秒 |

### フェーズ切替の予告

切り替え前から段階的に予兆（アイコンの揺れが徐々に強くなる）を出す。

| レア度 | 予告開始（切替の何秒前） |
|---|---|
| コモン | 0.8秒前 |
| レア | 0.6秒前 |
| スーパーレア | 0.45秒前 |
| 伝説 | 0.3秒前 |

### フィードバック設計（音響＋画面演出）

- PCでの利用が中心のため、振動（Vibration API）は採用せず、**Web Audio APIによる低音の「サム」音**と**Web Animations APIによる画面演出（シェイク・ズーム・フラッシュ）**の組み合わせでフィードバックを設計する
- 音は`AudioContext`で生成する短い減衰音、画面演出は対象要素（Canvasの外側のラッパーdiv）に対して`element.animate()`で実装する
- 巻き上げ連打1回ごと：短いクリック音（400Hz, 30ms, 小音量）、画面演出なし
- アタリ発生時：高めのピン音（800Hz, 80ms）＋極小シェイク
- フェーズ予告開始時：弱い上昇音のみ
- フェーズ切替時：3連の中音（500Hz×3）＋小シェイク
- 釣果成功時（レア度別）：

  | レア度 | 音 | 画面演出 |
  |---|---|---|
  | コモン | 単発の低音サム | 小シェイク |
  | レア | 2連サム | 中シェイク |
  | スーパーレア | 3連サム＋高音の飾り | 中シェイク＋ズーム |
  | 伝説 | 4連サム＋持続音 | 大シェイク＋ズーム＋フラッシュ |

- 失敗時：単発の鈍い低音のみ（画面演出なし、成功との対比を出す）
- `AudioContext`は自動再生制限があるため、「出発する」ボタン押下で初期化する。出発演出をスキップした場合は最初の「キャスト」ボタン押下で初期化する
- 連打音は音量を絞り、簡易スロットル（前回再生から一定時間未満は無視）でうるさくなりすぎないようにする

## 7. 魚拓演出・収集フロー

- 魚拓を取れるのは**新種を釣り上げた時のみ**
- 釣果成功後、まずリザルト画面で天体名・レア度が判明（画像はシルエットのまま）
- **新種の場合**：「魚拓を取る」か「逃がす」かを選択できる
  - 取る → 図鑑に登録され、魚拓演出（下記4ステップ）が再生される
  - 逃がす → 記録されず、未収録のまま（ペナルティなし、再度出会えば選択可能）
- **既知の場合**：選択肢は出さず自動的に逃がす（少量の報酬を付与し、コンプリート後も釣る動機を残す）

### ポイントと交換（2026-09-26実装）

- 報酬は図鑑登録済みの対象を釣ることに成功した場合のみ、カタログの `point` を加算する。新種の登録・リリース、失敗では加算しない。
- 新種は「魚拓を取る」の選択時に登録する。既知の自動リリース時も累計釣獲数を更新する。
- ポイントは残高として保存し、交換所でアイテムと釣り場情報に交換できる。
- 誘引ルアーは消耗品。使用を選んだキャストの開始成立時に1個消費し、その1投の高レアリティ出現率を上げる。失敗・途中終了でも消費する。
- 星時計（制限時間延長）と強化リール（連打・長押しダメージ増加）は永久装備。購入後は自動で装備され、両方併用できる。重複購入はできない。
- 釣り場情報は座標範囲の開示。購入後は永続的に閲覧でき、待機画面に範囲を表示する。釣り場は未購入でも存在し、その範囲に投入すれば補正が働く。
- 範囲は投入点のワールド座標で境界を含めて判定し、キャスト開始時に効果を固定する。画面の座標表示は内部座標を `x / 10, -y / 10` に変換する。
- 初期の釣り場は全季節対応。釣り場が重複する場合はレア度ごとの最大補正、ルアーとの併用は乗算し、倍率6を上限とする。季節候補を絞り、レア度→同一レア度内の `weight` の順で抽選する。
- 交換価格・効果量は仮値。`backend/app/data/shop.json` と `frontend/src/data/shop.mock.json` で管理し、読込側のTODOに従い `point` 確定後に調整する。カタログ担当が未設定の `point` は互換性のため0として扱う。
- 残高・所持品・釣り試行・交換記録はバックエンドへ保存する。通信再送でも付与・消費・購入を重複させず、未確認の操作は再読込後にも同じIDで確認できる。
- バックエンド未起動時はモックで同じ基本フローを動作させ、進捗をローカル保存する。オンラインの残高とは混合しない。

### 魚拓演出の4ステップ

1. **引き上げ**：水しぶき＋シルエットの演出
2. **スタンプ演出**：墨調フレームが重なり、画像がグレースケール/セピア表示になる
3. **実写反転**：`filter`をアニメーションさせ、モノクロから実写カラーへ変化（斜めのclip-pathマスクだとより魚拓らしい）
4. **情報表示**：天体名・探査機名・撮影日・クレジット表記を表示し、図鑑に登録

### レア度別の演出強度

| レア度 | 尺 | 装飾 | 追加演出 |
|---|---|---|---|
| コモン | 約1.2秒 | シンプルな墨枠 | なし |
| レア | 約1.8秒 | 金の縁取り | 軽い光の粒子 |
| スーパーレア | 約2.5秒 | 豪華な縁取り+和柄 | カメラズーム |
| 伝説 | 約3.5秒 | 金箔調の縁取り | 画面フラッシュ+粒子+スローモーション |

- 演出はタップでスキップ可能にする
- パーティクル数は全レア度で上限を固定し、色・サイズ・持続時間で差をつける（パフォーマンス対策）

## 8. 図鑑UI設計

### 一覧画面

- 図鑑番号（No.001等）は収録状況に関わらず常時表示
- 未収録：シルエット＋「???」のみ、レア度も非表示（統一された見た目でサプライズを守る）
- 収録済み：実写サムネイル＋天体名＋探査機名＋レア度バッジを表示
- 上部に収録数の進捗バー、レア度別のフィルターチップを配置

### 詳細モーダル（収録済みタップ時）

- レア度バッジ、閉じるボタン
- 実写画像（魚拓演出の最終カラー画像）
- 天体名／探査機名
- 撮影日（史実の日付）／初収集日（プレイヤーの記録）／累計釣獲数
- フレーバーテキスト（独自文章）
- クレジット表記（©JAXA、常時表示）
- 「魚拓演出をもう一度見る」ボタン（初回より短縮版を検討）

### 未収録タップ時（要検討）

- ヒントのみ表示（名前は明かさず、レア度を★の数などで示す程度）※詳細は今後詰める

## 9. フロントエンド技術選定

| 領域 | 選定 | 理由 |
|---|---|---|
| フレームワーク | React + TypeScript | 図鑑・モーダル等のUIをコンポーネント単位で構築でき、型でスキーマを共有できる |
| ビルドツール | Vite | 高速なHMR、Macでの開発体験が良い |
| 描画（星空・釣り演出） | Canvas2D | Three.jsより学習コストが低く、2人チームでの保守性とUIとの連携がしやすい（Three.jsは将来の拡張候補） |
| 状態管理 | Zustand | 釣りの一時状態と図鑑の永続状態を軽量に管理 |
| スタイリング | CSS Modules／部分的にTailwind | 独自の装飾が多いUIと定型UIを使い分け |
| API通信 | fetch + 簡易ラッパー | 通信量が少なく大掛かりなライブラリ不要 |
| デプロイ | Vercel | GitHub連携で即デプロイ可能 |

### レイヤー構造

- 描画レイヤー：星空・釣り演出（Canvas2D）
- UIレイヤー：図鑑・モーダル（Reactコンポーネント）
- 状態/APIレイヤー：Zustand + fetch、バックエンドとの通信

## 10. バックエンド技術選定

| 領域 | 選定 | 理由 |
|---|---|---|
| 言語/フレームワーク | FastAPI（Python） | JAXA Earth APIが公式にPythonライブラリを提供しており直接連携できる。Pydanticで型安全にできる |
| DB（開発） | SQLite | セットアップ不要、ファイル1つで完結 |
| DB（本番） | Postgres（Supabase等） | 接続文字列の差し替えのみで移行できる構成にする |
| ORM | SQLModel | Pydanticモデルがそのままテーブル定義になる |
| 認証 | 匿名デバイスID（UUID、localStorage保存） | ログイン機能を省略し工数を圧縮。将来的にアカウント機能へ拡張可能 |
| 画像ホスティング | 自前ストレージ（Supabase Storage/Cloudflare R2等） | JAXA画像への直リンクによるリンク切れ・表示崩れを回避（利用条件の再配布可否は要確認） |

### テーブル設計

| テーブル | 主なフィールド |
|---|---|
| `catalog` | `id`, `body_name`, `mission_name`, `image_url`, `credit_text`, `rarity`, `flavor_text` |
| `users` | `id`, `device_id`, `created_at` |
| `collections` | `user_id`, `species_id`, `first_caught_at`, `catch_count` |

### APIエンドポイント

| エンドポイント | 役割 |
|---|---|
| `POST /api/cast/start` | サーバー側で天体を抽選し、ミニゲームの難易度パラメータを返す |
| `POST /api/cast/resolve` | 成否を確定し天体情報を返す。既知なら釣獲数とポイントを更新 |
| `POST /api/cast/decision` | 新種の魚拓登録／リリースを確定 |
| `GET /api/economy` | 残高・所持品・購入済み釣り場情報を取得 |
| `GET /api/economy/products` | 交換商品・価格・効果を取得 |
| `POST /api/economy/exchange` | ポイントを消費して商品を取得 |
| `GET /api/catalog` | 図鑑グリッド用の全天体マスタデータ |
| `GET /api/collection` | ユーザーごとの収集状況 |

## 11. 環境構築手順

### 前提として揃えておくもの

```bash
# Xcodeコマンドラインツール
xcode-select --install

# Homebrew
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# Git
brew install git
```

### バージョン管理ツール（2人でバージョンを揃える）

```bash
# Node.js用（nvm）
brew install nvm
mkdir ~/.nvm
echo 'export NVM_DIR="$HOME/.nvm"' >> ~/.zshrc
echo '[ -s "/opt/homebrew/opt/nvm/nvm.sh" ] && . "/opt/homebrew/opt/nvm/nvm.sh"' >> ~/.zshrc
source ~/.zshrc

# Python用（pyenv）
brew install pyenv
echo 'eval "$(pyenv init -)"' >> ~/.zshrc
source ~/.zshrc
```

リポジトリ直下に `.nvmrc` と `.python-version` を置き、`nvm use` / `pyenv local` で2人とも同じバージョンに揃える。

```bash
nvm install 22 && nvm use 22 && node -v > .nvmrc
pyenv install 3.12 && pyenv local 3.12
```

### リポジトリ構成

フロントとバックを1つにまとめたモノレポ構成を採用。

```
space-fishing/
├── frontend/     # React + TypeScript + Vite
├── backend/      # FastAPI
├── .gitignore
└── README.md
```

ブランチ運用は `main` ＋機能ごとの短命ブランチ（例：`feature/gyotaku-animation`）。

### フロントエンド環境構築

```bash
cd space-fishing
npm create vite@latest frontend -- --template react-ts
cd frontend
npm install
npm install zustand
npm run dev   # http://localhost:5173 で確認
```

### バックエンド環境構築

```bash
cd space-fishing
mkdir backend && cd backend
python -m venv .venv
source .venv/bin/activate

pip install fastapi uvicorn sqlmodel python-dotenv

# JAXA Earth API（依存はmatplotlib/requestsのみで導入は軽い）
pip install --extra-index-url https://data.earth.jaxa.jp/api/python/repository/ jaxa-earth

pip freeze > requirements.txt

uvicorn main:app --reload   # http://localhost:8000 で確認
```

### フロントとバックの疎通設定

開発中はポートが異なる（5173と8000）ため、FastAPI側でCORSを許可する。

```python
from fastapi.middleware.cors import CORSMiddleware

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)
```

### 環境変数・秘匿情報の管理

`backend/.env`（本番DB移行時のSupabase接続文字列などを格納）：

```
DATABASE_URL=sqlite:///./dev.db
```

`.gitignore` に最低限含めるもの：

```
.venv/
node_modules/
.env
*.db
```

### 動作確認チェックリスト

- [ ] `frontend` で `npm run dev` が起動し、ブラウザで画面が見える
- [ ] `backend` で `uvicorn main:app --reload` が起動し、`/docs` でSwagger UIが見える
- [ ] フロントから `fetch('http://localhost:8000/...')` が叩けてCORSエラーが出ない
- [ ] 2人とも同じNode/Pythonバージョンで動作している（`node -v` / `python -V` で確認）

### 補足

DBは開発中SQLiteで進めるため、Supabase等の外部サービスのアカウント作成は本番デプロイが視野に入った段階で行えば十分（今すぐは不要）。

## 12. 釣りの「実際に操作している感」を高める技術的工夫

体力ゲージ制のロジック自体は変更せず、その数値を物理っぽい見た目に変換する表現レイヤーを追加する方針。

### ラインのたわみ表現

テンション値（魚が引いている強さ）に応じて、竿先〜ルアー間を結ぶ線の制御点をずらし、二次ベジェ曲線で描画する。テンションが低いほどラインがたるむ。

```js
function drawLine(ctx, rodTip, lurePos, tension) {
  const sag = (1 - tension) * 40;
  const midX = (rodTip.x + lurePos.x) / 2;
  const midY = (rodTip.y + lurePos.y) / 2 + sag;
  ctx.beginPath();
  ctx.moveTo(rodTip.x, rodTip.y);
  ctx.quadraticCurveTo(midX, midY, lurePos.x, lurePos.y);
  ctx.strokeStyle = 'rgba(255,255,255,0.6)';
  ctx.lineWidth = 1.5;
  ctx.stroke();
}
```

### 竿先のしなり（バネ・ダンパー）

竿先やゲージ等の数値変化を瞬間移動させず、バネ・ダンパー系で目標値へ追従させることで「しなって戻る」動きを出す。フレームレート非依存にするため `deltaTime` ベースで計算する。

```js
function springTo(current, target, velocity, stiffness = 120, damping = 12, dt) {
  const force = (target - current) * stiffness - velocity * damping;
  const newVelocity = velocity + force * dt;
  const newValue = current + newVelocity * dt;
  return [newValue, newVelocity];
}
```

### リールのクランク（慣性回転）

連打／長押しの入力を、見た目のクランク（ハンドル）の回転角度に直接変換し、入力をやめると慣性で徐々に減速させる。

```js
let crankAngle = 0;
let crankVelocity = 0;

function onReelTap() {
  crankVelocity += 25;
}

function updateCrank(dt) {
  crankVelocity *= Math.pow(0.05, dt);
  crankAngle += crankVelocity * dt;
}
```

音響（既存のフィードバック設計）は `crankVelocity` に応じてクリック音の間隔・ピッチを変化させ、視覚と聴覚を同期させる。

### 抵抗のゆらぎ（疑似ノイズ）

体力ゲージの回復速度や抵抗の強さに、複数周波数のsin波を重ねた疑似ノイズを掛け合わせ、「時々グッと強まる」生物的な抵抗感を出す。

```js
function organicResistance(t, baseValue) {
  const noise =
    Math.sin(t * 2.1) * 0.5 +
    Math.sin(t * 5.3 + 1.7) * 0.3 +
    Math.sin(t * 11.0 + 0.4) * 0.2;
  return baseValue * (1 + noise * 0.25);
}
```

### アンティシペーションとフォロースルー

- アタリの瞬間：即座に反応させず、竿先が沈み込む予備動作を50ms程度挟んでから本反応を出す
- 釣果確定の瞬間：ゲージが0になった直後すぐ結果画面に切り替えず、竿が軽く跳ねる余韻を200ms程度入れる

### フレームレート非依存の実装

ProMotion（120Hz）と通常の60Hzモニターが混在するため、物理更新は `requestAnimationFrame` の `deltaTime` ベースで統一し、`dt` を大きすぎる値でクランプする。

```js
let lastTime = performance.now();
function loop(now) {
  const dt = Math.min((now - lastTime) / 1000, 0.05);
  lastTime = now;
  updateCrank(dt);
  requestAnimationFrame(loop);
}
```

## 13. カメラ・視点演出

固定視点をやめ、独立した `camera`（位置・ズーム）オブジェクトを介して描画することで、視点移動による生命感・臨場感を出す。前章の `springTo` をそのまま流用する。

### カメラの基本構造

```js
class Camera {
  constructor() {
    this.x = 0; this.y = 0; this.zoom = 1;
    this.vx = 0; this.vy = 0; this.vzoom = 0;
    this.targetX = 0; this.targetY = 0; this.targetZoom = 1;
  }
  update(dt) {
    [this.x, this.vx] = springTo(this.x, this.targetX, this.vx, 90, 14, dt);
    [this.y, this.vy] = springTo(this.y, this.targetY, this.vy, 90, 14, dt);
    [this.zoom, this.vzoom] = springTo(this.zoom, this.targetZoom, this.vzoom, 60, 14, dt);
  }
  apply(ctx, w, h) {
    ctx.save();
    ctx.translate(w / 2, h / 2);
    ctx.scale(this.zoom, this.zoom);
    ctx.translate(-this.x, -this.y);
  }
  restore(ctx) { ctx.restore(); }
}
```

### フェーズごとのカメラの振る舞い

| フェーズ | カメラの動き | 狙い |
|---|---|---|
| 待機 | 中心付近をゆっくり漂う（`sin(t*0.05)*10`程度） | 画面が死なない、呼吸感 |
| キャスト | ルアーの飛距離に合わせてターゲット位置が遠くへ移動、一瞬ズームアウト | 「飛んでいった」実感 |
| アタリ待ち | ズームがじわじわ`1.0→1.05`へ | 待っている間の緊張感 |
| 巻き上げ | ターゲットがルアー（魚）の位置を追従、ズームをやや引く | 暴れる魚を追いかけている感覚 |
| 成功（魚拓演出） | 釣れた位置へ一気にズームイン（レア度に応じて強さ変更） | クローズアップでの見せ場 |
| 失敗 | 一瞬ズームアウトしてから戻る | 逃げられた喪失感 |

巻き上げ中はルアーの位置自体を `organicResistance` でふらつかせ、カメラがそれを追従することで「暴れる獲物を捉えている」映像になる。

### 画面シェイクの統合（trauma方式）

既存の画面シェイク演出をカメラの揺れとして統合する。瞬間的な強さを `trauma`（0〜1）に加算し、時間とともに減衰させ、揺れ幅は `trauma²` で計算する。

```js
let trauma = 0;
function addTrauma(amount) { trauma = Math.min(1, trauma + amount); }

function updateShake(dt, t) {
  trauma = Math.max(0, trauma - dt * 1.5);
  const shake = trauma * trauma;
  return {
    x: 12 * shake * Math.sin(t * 37.1),
    y: 12 * shake * Math.sin(t * 29.3 + 2.1),
  };
}
```

フェーズ切替や釣果成功時に `addTrauma()` を呼び、既存の音響・画面演出のタイミングと連動させる。

### パララックス（星空の多層化）

星空を複数レイヤーに分け、遠いレイヤーほどカメラの動きへの追従係数（`depthFactor`）を小さくすることで奥行きを出す。Canvas2Dでの星空パーティクル実装の土台にする。

```js
function drawStarLayer(ctx, camera, stars, depthFactor) {
  const offsetX = -camera.x * depthFactor;
  const offsetY = -camera.y * depthFactor;
  for (const s of stars) {
    ctx.beginPath();
    ctx.arc(s.x + offsetX, s.y + offsetY, s.r, 0, Math.PI * 2);
    ctx.fill();
  }
}
```

### PCならではの追加：マウス追従パララックス

待機中のみ、マウス位置に応じてカメラがわずかに動く演出を加える。操作中（巻き上げ等）は照準のズレを避けるため無効化する。

```js
canvas.addEventListener('pointermove', (e) => {
  if (currentPhase !== 'idle') return;
  const dx = (e.clientX - canvas.width / 2) / canvas.width;
  const dy = (e.clientY - canvas.height / 2) / canvas.height;
  camera.targetX = idleCenter.x + dx * 15;
  camera.targetY = idleCenter.y + dy * 15;
});
```

### 酔い対策

ズーム・移動の変化量が大きすぎると映像酔いにつながるため、`spring`のstiffness値は上記程度に抑え、ズーム倍率は1.8倍程度を上限にする。設定画面に「カメラ演出の強さ」を弱/標準で切り替えるオプションを用意する。

## 14. 「地球引き」について（アイデアメモ）

- JAXA Earth APIの活用方針（2章）検討時に出た、A案（地球の夜景データを天の川に見立てる）の名残として温存している特殊イベント案
- 通常は天体（イトカワ、金星、リュウグウ等）が釣れるところ、**ごく稀に「地球」そのものが釣れる**という特殊演出
- 表示する画像は実写の探査機画像ではなく、JAXA Earth APIから取得した実際の地球の夜間光データ（都市の光が輝く地球の姿）
- 現状はカタログ表（4章）に未組み込みのアイデア段階。詰める場合は以下を検討する必要あり：
  - レア度の位置づけ（伝説より上の隠し枠か、独立した特殊イベント扱いか）
  - 図鑑に登録されるものか、一回きりの演出で終わるものか
  - 夜間光データの取得タイミング（毎回リアルタイム取得か、候補をキャッシュしておくか）

## 15. 今後詰める項目（未決定）

- 未収録カードをタップした時のヒントモーダルの中身
- catalog投入用のシードスクリプトの形式
- 2人での具体的なタスク割り・開発スケジュール
- Canvas2Dでの星空パーティクルの具体的な実装方針（13章のパララックス構造をベースに詳細化）
- ゲームパッド接続時の物理振動（Gamepad API の `vibrationActuator`）を追加するかどうか（Safari非対応など対応状況が限定的なため保留、実装する場合はあくまでオプション演出として扱う）
- 「地球引き」演出を実装するかどうか、実装する場合の仕様
