# Claude Code での実現方法

出典: https://code.claude.com/docs/en/sub-agents

## 指定できること

**モデルは起動のたびに指定できる。** Agent ツールの `model` パラメータに別名(`haiku` / `sonnet` / `opus` / `fable`)か完全な ID を渡す。優先順位は、起動時の指定 → 定義ファイルの `model` → 環境変数 `CLAUDE_CODE_SUBAGENT_MODEL` → メインのモデル。

**effort は起動時には指定できない。** 定義ファイルの frontmatter(`effort:`)でだけ決められ、書かれていなければセッションの effort を引き継ぐ。定義を入れずにモデルだけ使い分けると、M の仕事もセッションの effort(多くは `high`)で走る。

**組み込みの Explore は安くない。** 以前は Haiku 固定だったが、現在はメインのモデルを引き継ぐ(上限は Opus)。メインが Fable のとき、Explore は Opus、つまり H 段で走る。探索は M の仕事なので、Explore には任せず、`tier-m` か、汎用の subagent を `model: sonnet` で明示して起動する。

## 同梱の定義(`tier-m` / `tier-h` / `tier-x`)

役割ごとではなく段ごとの定義で、役割は毎回の指示書で与える。まず、利用可能な subagent の一覧を見て、どの形で入っているかを確かめる。

- **`subagent-model-router:tier-m` のように plugin 名つきで並んでいる** → このスキルが plugin として入っており、定義は自動で読み込まれている。何もコピーせず、その名前(`subagent-model-router:tier-m` / `:tier-h` / `:tier-x`)で起動する。以下の説明の `tier-m` などは、この名前に読み替える。
- **`tier-m` などが plugin 名なしで並んでいる** → 既にコピー済み。そのまま使う。
- **どちらもない** → スキル単体で入っている。ユーザーに一言確認してから、`assets/claude-code-agents/` の 3 ファイルをプロジェクトの `.claude/agents/`(迷ったらこちら)か `~/.claude/agents/` にコピーする。コピー先の `agents` ディレクトリがセッション開始時に存在しなかった場合だけ、再起動するまで読み込まれない。その場合は再起動が必要だと伝え、今回は下の「定義なしで進める」で進める。既にあるディレクトリへの追加は数秒で反映される。

plugin の定義は更新のたびに上書きされるので、effort を書き換えたいとき(下の表)は、該当ファイルを `.claude/agents/` にコピーして編集する。コピーしたものは plugin 名なしの `tier-h` などとして別に読み込まれるので、以降はそちらを起動する。

**L 段を使うとき**(ユーザーが「安く」と求めた場合のみ)は、`tier-m` を `model: haiku` で起動する。Haiku は effort に対応していないので、定義の effort は効かない。

## 定義なしで進める

汎用の subagent に `model` だけ指定して使う(M は `sonnet`、H は `opus`、X は `fable`)。effort はセッションの値が全員に適用される。メインが Fable で高い effort のまま M を大量に並列化すると消費が大きいので、その前に定義を入れるよう、ユーザーに一言伝える。

## effort だけ上げる

起動時の `model` は定義の `model` より優先され、effort は定義のものが残る。これを使う。

| 元 | effort だけ上げる | モデルも上げる |
|---|---|---|
| `tier-m`(M × medium) | `tier-h` を `model: sonnet` で起動(M × high) | `tier-h` |
| `tier-h`(H × high) | 定義の effort を `xhigh` に書き換える | `tier-x` |
| `tier-x`(X × high) | 定義の effort を `xhigh` に書き換える(1 回だけ) | 上はない。計画に戻る |

## 指摘の修正は再開で

完了した subagent は、返ってきた ID か名前を宛先にした `SendMessage` で再開できる。それまでの文脈を保ったまま続きをやるので、検証の指摘を元の実装担当に直させるときは、新規に起こすより安くて正確になる。組み込みの Explore と Plan は再開できない。

## 効いているか確かめる

実際の effort はメインからも subagent 自身からも観測できない。ユーザーは `/tasks` で、実行中の subagent の行にモデル(と、定義が effort を指定していれば effort)が出るのを確認できる。初回や長時間の作業では、最初の subagent を起動した時点で「`/tasks` で意図どおりか見てほしい」と一言添える。

次の場合は指定が効かない。警告や `/tasks` の表示で気づいたら、ユーザーに伝える。

- 環境変数 `CLAUDE_CODE_SUBAGENT_MODEL_FORCE=1` が設定されている(全 subagent が 1 つのモデルに固定され、起動時の指定もできない)
- 組織の許可リストで指定モデルが塞がれている(別のモデルに差し替えられ、警告が出る)

同時に走らせられる subagent は既定で 20 まで。
