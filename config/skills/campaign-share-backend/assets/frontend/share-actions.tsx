/**
 * 結果画面のシェア操作（React 例）。ボタンの見た目はデザインに合わせて差し替える。
 *
 * 要点:
 * - 表示時に createShareCard で事前生成し、完成まではボタンを disabled にする
 * - 押下時は await せず同期で window.open / clipboard / a[download]（transient activation を失わない）
 * - 画像 DL は同一オリジンの /u/{id}.png を download 属性付きリンクで保存（fetch を挟まない）。
 *   Safari 対策で DOM に追加してから click する
 */
import { useEffect, useState } from 'react'
import { createShareCard, type ShareCard } from './api-client'
import type { ResultPayload } from './types'

type Props = {
  /**
   * useState / useMemo で同一参照を保つこと。createShareCard のメモ化と下の card 判定は参照で比較するため、
   * JSX 内で毎回オブジェクトを作ると描画のたびに POST が飛ぶ
   */
  result: ResultPayload
  /** 例: 'スコア{score}点！ #ハッシュタグ'。置換はサイトごとに */
  shareText: string
}

export function ShareActions({ result, shareText }: Props) {
  // 生成元の result と組で持つ。result が変わった直後に前回の URL をシェアしないため
  const [generated, setGenerated] = useState<{ result: ResultPayload; card: ShareCard } | null>(null)
  const card = generated?.result === result ? generated.card : null

  useEffect(() => {
    let cancelled = false
    createShareCard(result)
      .then((c) => {
        if (!cancelled) setGenerated({ result, card: c })
      })
      .catch((error) => console.warn('[share] failed to create share card', error))
    return () => {
      cancelled = true
    }
  }, [result])

  const onShareX = () => {
    if (!card) return
    const intent = new URL('https://x.com/intent/post')
    intent.searchParams.set('text', shareText.replaceAll('{score}', result.score.toLocaleString('en-US')))
    intent.searchParams.set('url', card.shareUrl)
    window.open(intent.toString(), '_blank', 'noopener,noreferrer')
  }

  const onShareLine = () => {
    if (!card) return
    const url = new URL('https://social-plugins.line.me/lineit/share')
    url.searchParams.set('url', card.shareUrl)
    window.open(url.toString(), '_blank', 'noopener,noreferrer')
  }

  const canCopy = typeof navigator !== 'undefined' && !!navigator.clipboard && window.isSecureContext
  const onCopy = () => {
    if (!card || !canCopy) return
    navigator.clipboard.writeText(card.shareUrl).catch((e) => console.warn('[share] copy failed', e))
  }

  const onDownload = () => {
    if (!card) return
    const a = document.createElement('a')
    a.href = card.imageUrl
    a.download = card.imageUrl.split('/').pop() ?? 'share.png'
    a.rel = 'noopener'
    a.style.display = 'none'
    document.body.appendChild(a)
    a.click()
    a.remove()
  }

  return (
    <div>
      <button type="button" disabled={!card} onClick={onShareX}>X でシェア</button>
      <button type="button" disabled={!card} onClick={onShareLine}>LINE で送る</button>
      <button type="button" disabled={!card || !canCopy} onClick={onCopy}>URL をコピー</button>
      <button type="button" disabled={!card} onClick={onDownload}>画像を保存</button>
    </div>
  )
}
