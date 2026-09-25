# その他の環境での実現方法

- [Claude Agent SDK](#claude-agent-sdk)
- [API で自前に組む](#api-で自前に組む)
- [subagent がない環境](#subagent-がない環境)
- [それ以外](#それ以外)

## Claude Agent SDK

出典: https://code.claude.com/docs/en/agent-sdk/subagents

`agents` オプションに段ごとの定義を渡す。定義には `description`、`prompt`、`tools`、`model`、`effort` などを書ける。CLI の `--agents` に渡す場合の形:

```json
{
  "tier-m": { "description": "M: 手順の決まった作業", "prompt": "<assets/claude-code-agents/tier-m.md の本文>", "model": "sonnet", "effort": "medium" },
  "tier-h": { "description": "H: 仕様の明確な作業", "prompt": "<tier-h.md の本文>", "model": "opus", "effort": "high" },
  "tier-x": { "description": "X: 判断が成果物の作業", "prompt": "<tier-x.md の本文>", "model": "fable", "effort": "high" }
}
```

メインが subagent を自動承認で呼べるよう、許可するツールに `Agent` を含める。

## API で自前に組む

段階ごとに別のリクエスト(別の会話)を立てれば、それが subagent になる。モデルも effort もリクエストごとに決められるので、制約が一番少ない。システムプロンプトには同梱の定義の本文を、ユーザーメッセージには SKILL.md 5 節の指示書を入れる。

Anthropic の API:

```python
client.messages.create(
    model="claude-sonnet-5",              # M。H は claude-opus-5、X は claude-fable-5-1
    output_config={"effort": "medium"},
    max_tokens=16000,                     # xhigh / max では大きく取る
    system=WORKER_PROMPT,
    messages=[{"role": "user", "content": brief}],
)
```

OpenAI の API(Responses):

```python
client.responses.create(
    model="gpt-6-luna",                   # M。H は gpt-6-sol、X は gpt-6-astra
    reasoning={"effort": "medium"},
    instructions=WORKER_PROMPT,
    input=brief,
)
```

- 戻りの「不確かな点」をコードで拾えば、引き上げを自動化できる。
- 1 つの会話の途中で effort を変えるとプロンプトキャッシュが効かなくなることが多い。段を変えるときは会話ごと分ける。
- 独立した調査タスクが多く、急がないなら、どちらの API もバッチ処理で単価が半分になる。
- 両社のモデルを混ぜて組むこともできる。検証の担当を実装の担当と別の系統にすると、同じ癖の見落としが重なりにくい。

## subagent がない環境

claude.ai や ChatGPT のチャットなど、自分で別のエージェントを起動できない場合。モデルの振り分けは自動ではできないが、段階の分割は 1 つの文脈でも効く。

1. **段階を分けて進める。** 調査が終わったら、結果を「事実と根拠」の短いメモにまとめ、以降はそのメモを土台にする。
2. **計画表に段の列を作る。** 自分では切り替えられなくても、どこが X でどこが M かをユーザーに見せる価値がある。
3. **検証はまっさらな目の代わりをする。** 元の要件を読み直し、成果物と 1 項目ずつ照らす。自分の経緯の説明は根拠にしない。
4. **モデルの切り替えはユーザーに提案する。** 会話の途中でモデルを切り替えられる環境なら、計画表を見せるときに 1 回だけ、「計画と最終検証は最上位モデルのまま、仕様の決まった実装は 1 段下のモデルが向く」と添える。繰り返さない。

## それ以外

Cowork や独自のエージェント基盤など。subagent を起動する道具のパラメータを見る。

- モデルを受け付ける → モデルだけ使い分ける
- 定義ファイルや設定で effort を決められる → 同梱の定義を移植する
- どちらも無理 → 段階の分割と、別の文脈での独立した検証だけを行う
