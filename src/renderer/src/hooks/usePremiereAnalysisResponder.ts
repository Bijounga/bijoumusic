import { useEffect } from 'react'
import type { PremiereAnalyzeRequest, PremiereAnalyzeResult } from '@shared/types'
import { detectSilenceSegments, measureLoudnessLufs } from '../audio/audioAnalysis'

/** Mounted once at the app root — answers audio-analysis requests the main
 *  process forwards on behalf of Premiere selection tools (silence-trim, LUFS
 *  normalize). decodeAudioData only exists here in the renderer, not main,
 *  which is why this round-trips through IPC instead of main doing it directly. */
export function usePremiereAnalysisResponder(): void {
  useEffect(() => {
    return window.api.onPremiereAnalyzeRequest((request) => {
      void handleRequest(request)
    })
  }, [])
}

async function handleRequest(request: PremiereAnalyzeRequest): Promise<void> {
  try {
    const arrayBuffer = request.bytes.buffer.slice(
      request.bytes.byteOffset,
      request.bytes.byteOffset + request.bytes.byteLength
    ) as ArrayBuffer

    const audioContext = new AudioContext()
    let audioBuffer: AudioBuffer
    try {
      audioBuffer = await audioContext.decodeAudioData(arrayBuffer)
    } finally {
      void audioContext.close()
    }

    let result: PremiereAnalyzeResult
    if (request.mode === 'silence') {
      const segments = detectSilenceSegments(
        audioBuffer,
        request.searchStart,
        request.searchEnd,
        request.thresholdDb,
        request.minSilenceSeconds
      )
      result = { mode: 'silence', result: { segments } }
    } else {
      const measuredLufs = measureLoudnessLufs(audioBuffer)
      const target = request.targetLufs ?? -16
      const gainDeltaDb = Number.isFinite(measuredLufs) ? target - measuredLufs : 0
      result = { mode: 'lufs', result: { measuredLufs, gainDeltaDb } }
    }
    await window.api.premiereAnalyzeResponse(request.requestId, result)
  } catch (err) {
    await window.api.premiereAnalyzeResponse(
      request.requestId,
      null,
      err instanceof Error ? err.message : String(err)
    )
  }
}
