# OpenAI Codex での実現方法

出典: https://learn.chatgpt.com/docs/agent-configuration/subagents と https://learn.chatgpt.com/docs/models

## Claude Code との違い(先に押さえる)

| | Claude Code | Codex |
|---|---|---|
| 起動時に指定できるもの | モデルのみ | モデルと reasoning effort の両方 |
| 定義ファイルと起動時の指定がぶつかったら | 起動時の指定が勝つ | **定義ファイルが勝つ** |
| 定義ファイル | Markdown(`.claude/agents/`) | TOML(`.codex/agents/` か `~/.codex/agents/`) |
| subagent を起動する条件 | メインの判断で起動できる | ユーザーの直接の依頼か、スキルや AGENTS.md の指示があるとき |

このスキルの指示は、最後の行の「スキルの指示」に当たる。SKILL.md 1 節の条件を満たす作業なら、そのまま起動してよい。

## 基本: 組み込みの担当に、モデルと effort を明示して起動する

Codex には `default`(汎用)、`worker`(実装と修正)、`explorer`(読み取り中心の探索)が組み込まれている。定義ファイルを入れなくても、起動のたびにモデルと reasoning effort を明示すれば段を使い分けられる。

| 段 | 担当 | モデル | effort |
|---|---|---|---|
| M(調査) | `explorer` | `gpt-6-luna` | `medium` |
| M(定型の変更) | `worker` | `gpt-6-luna` | `medium` |
| H | `worker`(読み解きなら `explorer`) | `gpt-6-sol` | `high` |
| X | `default` か `worker` | `gpt-6-astra` | `high` |
| L(「安く」のときだけ) | `explorer` か `worker` | `gpt-6-luna` | `low` |

**モデルと effort は必ず両方書く。** どちらも省くと親の設定をそのまま引き継ぐ。メインは Astra なので、無指定の担当はすべて Astra で、しかも親と同じ effort で走る。モデルだけ指定して effort を省くと、そのモデルの既定の effort(`medium`)になり、H のつもりが `medium` で走る。

解決の順は、定義ファイルの固定値 → 起動時の指定 → `config.toml` の `[agents]` の既定 → 親の値。

## 起動時に指定できない場合: 同梱の定義を使う

版によっては、起動の道具がモデルや effort、担当の種類を受け付けないことがある。道具のパラメータを見て、受け付けないと分かったら定義ファイルに切り替える。

1. `assets/codex-agents/` の `tier_m.toml` / `tier_h.toml` / `tier_x.toml` を、ユーザーに一言確認してから、プロジェクトの `.codex/agents/`(迷ったらこちら)か `~/.codex/agents/` にコピーする。
2. 以降は `tier_m` などの名前で起動する。
3. 定義の種類すら選べない版では、モデルの使い分けは諦め、段階の分割と別スレッドでの独立した検証だけを行う。ユーザーには、`[agents]` の既定を M にしておくと無指定の subagent が安くなることを伝える:

```toml
[agents]
default_subagent_model = "gpt-6-luna"
default_subagent_reasoning_effort = "medium"
```

定義ファイルを使うときは、**固定値が起動時の指定に勝つ**ことに注意する。`tier_m` を起動時の指定で Sol に差し替えることはできない。引き上げるときは、上の段の定義か、組み込みの担当に明示指定して起動する。

## effort だけ上げる

組み込みの担当を、同じモデルのまま effort を 1 段上げて起動する(M なら `gpt-6-luna` × `high`、H なら `gpt-6-sol` × `xhigh`、X なら `gpt-6-astra` × `xhigh` を 1 回だけ)。

**`ultra` は subagent に指定しない。** 最大の思考に加えて自動で委譲を始める設定で、担当がさらに担当を増やしてしまう。メイン自身が Ultra で動いている場合は自発的に委譲が起きるが、そのときも段は計画表のとおりに指定する。

## 並列と入れ子

- 同時に開けるスレッド数には上限がある(`agents.max_concurrent_threads_per_session`。古い設定名は `agents.max_threads` で、既定は 6 だった)。並列の調査は上限の内側に収め、あふれる分は次の組に回す。
- subagent にさらに subagent を起動させない。指示書に「自分で完結させ、委譲しない」と書く。
- 並列にするのは読み取り中心の仕事から。同時に書き込む担当は、触るファイルが重ならないことを計画表で確かめてから。
- 同種のタスクが数十件あるときは、試し打ちが通った後で、CSV の 1 行を 1 担当に割り当てる一括起動(`spawn_agents_on_csv`、実験的機能)が使える。担当ごとの結果が CSV に戻るので、メインの文脈に中身が入らない。

## 権限

subagent は親のサンドボックスと承認の設定を引き継ぐ。検証の担当には指示書で「変更しない」と明示する。定義ファイルを使うなら `sandbox_mode = "read-only"` で強制できる。

## 指摘の修正と確認

- 開いたままの担当スレッドには追加の指示を送れる。検証の指摘は、新規に起こさず元の実装担当のスレッドに送る。
- ユーザーは CLI の `/agent` で担当スレッドを切り替えて中身を見られる。初回や長時間の作業では、最初の担当を起動した時点で、意図どおりのモデルと effort で動いているか見てほしいと一言添える。
