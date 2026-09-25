# 段とモデルの対応表

最終確認: 2026-09-25

モデルの世代が変わったら、この対応表と `references/codex.md`、`references/other-environments.md`、`assets/codex-agents/` のモデル名を合わせて直す。日付が古い、あるいは指定したモデルが使えないという警告が出たら、末尾の出典で現在の構成を確かめてから割り当てる。

## 前提: メインは X

このスキルは、メインが下の表の X の行のモデルで動いているときだけ使う(Claude 系なら Fable 5.1 か同等の Mythos 5.1、OpenAI 系なら GPT-6 Astra)。それ以外なら使わない。

## 現在の対応

| 段 | Claude 系(Claude Code) | OpenAI 系(Codex) |
|---|---|---|
| **M** | Sonnet 5 — `sonnet` × `medium` | GPT-6 Luna — `gpt-6-luna` × `medium` |
| **H** | Opus 5 — `opus` × `high` | GPT-6 Sol — `gpt-6-sol` × `high` |
| **X** | Fable 5.1 — `fable` × `high` | GPT-6 Astra — `gpt-6-astra` × `high` |
| L(既定では使わない) | Haiku 4.5 — `haiku`(effort は指定できない) | GPT-6 Luna — `gpt-6-luna` × `low` |

Claude 系の欄は Claude Code の別名。API の ID は順に `claude-sonnet-5`、`claude-opus-5`、`claude-fable-5-1`、`claude-haiku-4-5`。

effort の段階:

- Claude 系: `low` / `medium` / `high` / `xhigh` / `max`。Sonnet 5、Opus 5、Fable 5.1 が対応し、既定は `high`。
- OpenAI 系: `low` / `medium` / `high` / `xhigh` / `max` / `ultra`。既定は `medium`。**`ultra` は subagent に割り当てない**(最大の思考に加えて自動で委譲を始める設定で、担当がさらに担当を増やしてしまう)。

## 引き上げの順

| 元 | effort だけ上げる | モデルも上げる |
|---|---|---|
| M × `medium` | M × `high` | H × `high` |
| H × `high` | H × `xhigh` | X × `high` |
| X × `high` | X × `xhigh`(1 回だけ) | 上はない。計画に戻る |

`xhigh` と `max` は長時間の作業向けで、消費が大きい。X × `max` は、ユーザーが明示的に求めたときだけ使う。

## L 段を使う場合

L は既定では使わない。ユーザーが「安く」と求めたときに限り、M の仕事(手順まで決まっている仕事)の受け皿にする。使うときの注意:

- **Claude 系の Haiku 4.5** は effort に対応しておらず、文脈が 200K トークンと小さく、知識も古い(信頼できる範囲は 2025 年 2 月まで)。検索、一覧化、置換のように知識に頼らない仕事に限る。単価は Sonnet 5 の半分なので、下げる利得は小さい。
- **OpenAI 系の L** は M と同じ Luna を `low` effort で使う。モデルの単価は変わらないが、推論に使うトークンを減らせる場合がある。手順が決まった短い仕事に限る。
- L の失敗は、まず M に戻す。

## 費用の目安

100 万トークンあたりの入力 / 出力の単価。

- Claude 系: Sonnet 5 $2 / $10、Opus 5 $5 / $25、Fable 5.1 $10 / $50
- OpenAI 系(API 価格。Codex の利用枠やクレジット消費とは異なる): Luna $0.10 / $0.50、Sol $2 / $10、Astra $10 / $50

モデル間の価格差は系統ごとに異なる。同じモデルでも effort を上げると消費トークンが増えることがある。考えても結果が変わらない仕事は、effort を下げることも検討する。

メインの X は 1 トークンが最も高い。読む量の多い仕事をメインの文脈に入れずに M へ出すことが、このスキルで一番効く節約になる。

## 使えないモデルがあるとき

- H(Opus 5 / Sol)が選べない → H の仕事は M × `high` で代用し、問 2 に当たるものは X に上げる。
- M(Sonnet 5 / Luna)が選べない → M の仕事は H × `low` で代用する。
- 引退予定に注意する。`gpt-5.5` は 2026-10-14 に ChatGPT サインインの Codex から外れる(後継候補は `gpt-6-sol`、利用できるプランでは `gpt-6-luna` も選べる)。`gpt-5.4` と `gpt-5.4-mini` は既に外れている。ユーザーの既存の定義にこれらが残っていたら、置き換えを一言提案する。

## 出典

- Claude のモデル構成: https://platform.claude.com/docs/en/models/overview
- Claude の effort: https://platform.claude.com/docs/en/build-with-claude/effort
- Codex のモデル構成: https://learn.chatgpt.com/docs/models
- Codex の subagent とモデル選択: https://learn.chatgpt.com/docs/agent-configuration/subagents
- OpenAI API の単価: https://developers.openai.com/api/docs/models
