# shia2n-app-template

新しいアプリを始めるときの雛形。`shia2n-core` を使った最小構成の React+Vite+Cloudflare Pages アプリ。

---

## 新アプリ立ち上げ手順

### ① このテンプレートから新規リポジトリ作成

GitHub の `shia2n-app-template` ページで **「Use this template」→「Create a new repository」** をクリック。

- Repository name: `my-new-app` など好きな名前
- Public / Private はどちらでもOK

### ② アプリ名を設定

`src/constants.js` を開いて書き換える：

```js
export const APP_ID   = "my-new-app";    // ← ポータルのFirestoreで使われるID
export const APP_NAME = "My New App";    // ← ログイン画面に表示される名前
```

### ③ Cloudflare Pages プロジェクト作成

Cloudflare Pages → **「Create a project」→「Connect to Git」** でこのリポジトリを選択。

ビルド設定：
| 項目 | 値 |
|---|---|
| Framework preset | **None** |
| Build command | `npm run build` |
| Build output directory | `dist` |

**重要：** `npm install` は Cloudflare が自動で実行する。Build command は `npm run build` のみでよい。shia2n-core は Public な GitHub リポなので、追加の認証トークンは不要。

### ④ 環境変数を設定

Cloudflare Pages → Settings → Environment variables に以下を全て追加（Production & Preview 両方）：

```
VITE_SUPABASE_URL                    ← Supabase プロジェクトのURL
VITE_SUPABASE_ANON_KEY               ← Supabase の anon key
VITE_FIREBASE_API_KEY                ← Firebase コンソールから取得
VITE_FIREBASE_AUTH_DOMAIN            ← Firebase コンソールから取得
VITE_FIREBASE_PROJECT_ID             ← Firebase コンソールから取得
VITE_FIREBASE_STORAGE_BUCKET         ← Firebase コンソールから取得
VITE_FIREBASE_MESSAGING_SENDER_ID    ← Firebase コンソールから取得
VITE_FIREBASE_APP_ID                 ← Firebase コンソールから取得
VITE_FIREBASE_DATABASE_ID            ← Firestore のカスタムDB ID（必須・忘れずに）
ANTHROPIC_API_KEY                    ← AI機能を使う場合のみ
```

既存アプリ（他のCloudflare Pagesプロジェクト）の環境変数をコピペするのが最速。値は全アプリで共通。

### ⑤ Firebase Authorized Domains に追加

Firebase Console → Authentication → Settings → **Authorized domains** → **Add domain**

アプリのURL（例：`my-new-app.pages.dev`、または独自ドメインのサブドメイン）を追加。**これを忘れるとログインポップアップが開いてすぐ閉じる**。

### ⑥ ポータルに新アプリを登録

[portal.shia2n.jp](https://portal.shia2n.jp) の App Management で：
- App ID: `my-new-app`（Step ② の APP_ID と同じ）
- URL: `https://my-new-app.pages.dev` またはカスタムドメイン
- Tier: 必要に応じて設定

または Firestore を直接編集：
- `users/{自分のUID}` → `allowedApps` 配列に `my-new-app` を追加

### ⑦ デプロイ

Cloudflare Pages → Deployments → **「Retry deployment」** または任意の Commit で自動デプロイ。

ブラウザで `https://my-new-app.pages.dev` にアクセスして、Google ログインできれば成功。

---

## このテンプレートに含まれるもの

```
├── package.json                 shia2n-core を依存として参照（Public）
├── vite.config.js               node_modules/shia2n-core の JSX を変換する設定
├── index.html                   DM Mono + Noto Sans JP
├── public/_redirects            SPA ルーティング
├── functions/api/claude.js      Claude API プロキシ
├── src/
│   ├── main.jsx                 AuthGuard で App をラップ
│   ├── App.jsx                  ヘッダー + タブ切替の最小構成
│   ├── constants.js             APP_ID と APP_NAME
│   └── screens/Home.jsx         サンプル画面
```

---

## shia2n-core から使えるもの

```jsx
import {
  AuthGuard, useAuthUid, useAuthUser,      // 認証
  auth, db, firebaseApp,                    // Firebase
  supabase,                                 // Supabase クライアント
  fetchAll, fetchOne, insertOne, updateOne, deleteOne, upsertOne,  // 汎用CRUD
  T, fmt, fmtK, currentMonth, today,        // トークン・ユーティリティ
  card, lb10, mc, inp, solidBtn, ghostBtn, mono,  // スタイル
  Delta,                                    // 共通コンポーネント
} from "shia2n-core";
```

**注意：** これらを**自分で再実装しない**。全てshia2n-coreから使う。特に AuthGuard は Firestore のカスタムDB ID を内部で正しく参照しているので、自前で `getFirestore()` を呼ばないこと。

---

## Supabase テーブル設計の規則

- テーブル名は **アプリごとのプレフィックス** を必ずつける（`xx_` など）
- `user_id` カラム（text型）を必ず持つ — shia2n-core の汎用 CRUD が自動でフィルタ
- 別名（`owner_uid`、`author_id` 等）は使わない — エコシステム全体の統一

---

## 必須チェックリスト（デプロイ前）

```
□ src/constants.js の APP_ID と APP_NAME を書き換えた
□ Cloudflare Pages の環境変数を全て設定した（特に VITE_FIREBASE_DATABASE_ID）
□ Cloudflare Pages の Build command が「npm run build」になっている
□ Firebase の Authorized Domains に新URLを追加した
□ ポータルの App Management に新アプリを登録した
□ Googleログイン → Home画面表示を確認した
```

---

## 変更履歴

- 2026-04-22：Build command を `npm run build` に簡素化（shia2n-core Public化に伴い、GITHUB_TOKEN 方式は廃止）
