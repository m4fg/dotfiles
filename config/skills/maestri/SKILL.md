---
name: "maestri"
description: "調査の時に使う。Use maestri CLI for multi-agent coordination: sending prompts to connected AI agents and reading their output (maestri ask/check), and managing shared notes between agents (maestri note read/write/edit). Trigger this skill whenever the user wants to communicate with another agent, check an agent's status or output, coordinate multi-agent workflows, or share data via notes — even if they don't say 'maestri' explicitly. "
---

# maestri

maestriはマルチエージェント連携のためのCLIツール。以下の2つの用途で使う：

1. **エージェント通信** — 他のエージェントにプロンプトを送り、出力を読む
2. **ノート管理** — エージェント間で共有するテキストを読み書きする

ブラウザ操作（portal系コマンド）は対象外。playwright MCPを使うこと。

## 起動前の確認

maestriが使える環境かどうか確認し、接続中のエージェントとノートを把握する：

```bash
maestri list
```

エージェント名・ノート名を操作前に必ず確認する。名前は大文字小文字を含め完全一致が必要。

接続に問題がある場合：

```bash
maestri debug
```

## エージェント通信

### プロンプトを送る

```bash
maestri ask "Agent Name" "プロンプト内容"
```

エージェントは非同期で処理する。送信後すぐには結果が出ない場合がある。

### 出力を読む

```bash
maestri check "Agent Name"
```

エージェントの現在のターミナル出力を取得する。まだ処理中の場合は少し待ってから再度実行する。

### 典型的なフロー

1. `maestri ask` でプロンプトを送信
2. 少し待って `maestri check` で出力確認
3. まだ処理中であれば待ってから再確認
4. 期待する出力が得られるまで繰り返す

## ノート管理

ノートはエージェント間でデータを渡したり、情報を永続化するための共有テキストストア。

### 読む

```bash
maestri note read "Note Name"
# 行範囲指定（任意）:
maestri note read "Note Name" 10 50    # 10〜50行目
```

### 書く（全体を置き換え）

```bash
maestri note write "Note Name" "内容"
```

### 編集（部分置換）

```bash
maestri note edit "Note Name" "置換前テキスト" "置換後テキスト"
```

部分的な変更には `edit`、全体を書き直す場合は `write` を使う。
