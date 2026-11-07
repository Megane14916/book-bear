import { useEffect, useRef } from 'react'
import { isIsbn13 } from './validation'

type Detector = { detect(video: HTMLVideoElement): Promise<{ rawValue: string }[]> }
type DetectorConstructor = {
  new(options: { formats: string[] }): Detector
  getSupportedFormats(): Promise<string[]>
}

export function IsbnCamera({ onFinish }: { onFinish: (result?: { isbn: string } | { error: string }) => void }) {
  const preview = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    const video = preview.current!
    let active = true
    let stream: MediaStream | undefined
    let timer: ReturnType<typeof setTimeout> | undefined

    function stop() {
      active = false
      clearTimeout(timer)
      stream?.getTracks().forEach((track) => track.stop())
      stream = undefined
      video.srcObject = null
    }
    function finish(result?: Parameters<typeof onFinish>[0]) {
      if (!active) return
      stop()
      onFinish(result)
    }
    function onHidden() { if (document.hidden) finish() }
    function onPageHide() { finish() }

    async function scan(detector: Detector) {
      if (!active) return
      try {
        const codes = video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA ? await detector.detect(video) : []
        if (!active) return
        const isbn = codes.find((code) => isIsbn13(code.rawValue))?.rawValue
        if (isbn) finish({ isbn })
        else timer = setTimeout(() => void scan(detector), 200)
      } catch { finish({ error: 'バーコードを読み取れませんでした。' }) }
    }

    async function start() {
      const { BarcodeDetector } = window as Window & { BarcodeDetector?: DetectorConstructor }
      const unsupported = 'このブラウザーはISBNバーコードの読み取りに対応していません。'
      if (!BarcodeDetector || !navigator.mediaDevices?.getUserMedia) { finish({ error: unsupported }); return }
      try {
        if (!(await BarcodeDetector.getSupportedFormats()).includes('ean_13')) { finish({ error: unsupported }); return }
        if (!active) return
        const detector = new BarcodeDetector({ formats: ['ean_13'] })
        const camera = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false })
        if (!active) { camera.getTracks().forEach((track) => track.stop()); return }
        stream = camera
        video.srcObject = stream
        await video.play()
        void scan(detector)
      } catch (error) {
        const denied = error instanceof DOMException && error.name === 'NotAllowedError'
        finish({ error: denied ? 'カメラの利用が許可されませんでした。' : 'カメラを起動できませんでした。' })
      }
    }
    document.addEventListener('visibilitychange', onHidden)
    window.addEventListener('pagehide', onPageHide)
    void start()
    return () => {
      stop()
      document.removeEventListener('visibilitychange', onHidden)
      window.removeEventListener('pagehide', onPageHide)
    }
  }, [onFinish])

  return <section className="space-y-3 rounded-xl border bg-white p-4" aria-label="ISBNバーコード読み取り">
    <p className="text-sm">本のISBNバーコードをカメラに映してください。</p>
    <video ref={preview} muted playsInline className="aspect-video w-full rounded-lg bg-ink object-contain" aria-label="カメラのプレビュー" />
    <button type="button" className="ui-action border px-4 text-sm" onClick={() => onFinish()}>読み取りを中止</button>
  </section>
}
