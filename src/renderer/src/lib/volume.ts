// Volume scale shared by the main player and the pop-out mini player. Kept out
// of AudioEngine.ts so the mini player can use it without importing the audio
// engine (which would start a second player in that window).

// Quiet recordings (e.g. some WAV rips) never reach a comfortable level at 100% —
// the engine routes through a GainNode instead of relying on <audio>.volume (hard-
// capped at 1), so the boost can go up to 200%.
export const MAX_VOLUME = 2

// The 0-100% range gets most of the slider; boosting past 100% (up to MAX_VOLUME)
// is squeezed into the remaining stretch so the bar reads "mostly normal range, a
// little extra headroom" instead of half the bar being boost you rarely need.
export const BOOST_START_PERCENT = 75

export function volumeToSliderPercent(volume: number): number {
  if (volume <= 1) return volume * BOOST_START_PERCENT
  const boostFraction = (volume - 1) / (MAX_VOLUME - 1)
  return BOOST_START_PERCENT + boostFraction * (100 - BOOST_START_PERCENT)
}

export function sliderPercentToVolume(percent: number): number {
  if (percent <= BOOST_START_PERCENT) return percent / BOOST_START_PERCENT
  const boostFraction = (percent - BOOST_START_PERCENT) / (100 - BOOST_START_PERCENT)
  return 1 + boostFraction * (MAX_VOLUME - 1)
}
