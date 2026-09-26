// Ripple-delete via Premiere's QE ("Quality Engineering") DOM — an
// undocumented but long-standing ExtendScript API that exposes real editing
// commands (like extract(), a true ripple delete) that the public DOM and the
// newer UXP scripting API don't have. Confirmed working pattern via VafnirCut
// (github.com/MrVAFNIR/PremierePro-silence-cutter-VafnirCut), a similar
// open-source silence-cutter — this is why this one tool lives in a CEP
// extension instead of BijouMusic's main UXP panel (premiere-extension/),
// which handles everything else (gain, pitch, nudge, stagger, LUFS).

/** Returns JSON describing the selected clip: its media path, its position on
 *  the sequence, and its own in/out into the source file (so the caller can
 *  scope silence analysis to what's actually placed, not the whole source). */
function getActiveClipData() {
  try {
    var seq = app.project.activeSequence
    if (!seq) return JSON.stringify({ error: 'No active sequence.' })
    var selection = seq.getSelection()
    if (!selection || selection.length === 0) {
      return JSON.stringify({ error: 'Select a clip on the timeline first.' })
    }
    var clip = selection[0]
    if (!clip.projectItem) return JSON.stringify({ error: 'Selected clip has no linked media.' })
    var path = clip.projectItem.getMediaPath()
    if (!path) return JSON.stringify({ error: 'Could not resolve the media path.' })
    return JSON.stringify({
      filePath: path,
      clipStart: clip.start.seconds,
      inPoint: clip.inPoint.seconds,
      outPoint: clip.outPoint.seconds
    })
  } catch (e) {
    return JSON.stringify({ error: 'JSX error: ' + e.message })
  }
}

/** Finds which audio track holds a given clip by matching its start/end time —
 *  the classic DOM doesn't expose a direct "which track am I on" property on
 *  a TrackItem, so this matches by position instead (same approach used
 *  throughout BijouMusic's UXP-side track-item matching this session). */
function findTrackIndexForClip(seq, clip) {
  for (var a = 0; a < seq.audioTracks.numTracks; a++) {
    var track = seq.audioTracks[a]
    for (var c = 0; c < track.clips.numItems; c++) {
      var candidate = track.clips[c]
      if (Math.abs(candidate.start.seconds - clip.start.seconds) < 0.001 &&
          Math.abs(candidate.end.seconds - clip.end.seconds) < 0.001) {
        return a
      }
    }
  }
  return -1
}

/** Ripple-deletes each gap (sequence-relative seconds, {start,end} pairs, as a
 *  JSON string) from the currently selected clip's own audio track, in
 *  reverse order so earlier gaps' timestamps stay valid as later ones close
 *  and shift everything after them earlier. Only the clip's own track is
 *  targeted — deliberately narrower than VafnirCut's whole-timeline sweep,
 *  since this is meant to clean up one selected clip, not ripple every track
 *  in the sequence. */
function cutGapsOnSelectedClip(gapsJson) {
  try {
    var gaps = JSON.parse(gapsJson)
    var seq = app.project.activeSequence
    if (!seq) return JSON.stringify({ error: 'No active sequence.' })
    var selection = seq.getSelection()
    if (!selection || selection.length === 0) {
      return JSON.stringify({ error: 'Select a clip on the timeline first.' })
    }
    var clip = selection[0]

    var trackIndex = findTrackIndexForClip(seq, clip)
    if (trackIndex === -1) return JSON.stringify({ error: "Could not find the selected clip's own track." })

    app.enableQE()
    var qeSeq = qe.project.getActiveSequence()

    for (var v = 0; v < seq.videoTracks.numTracks; v++) seq.videoTracks[v].setTargeted(false, true)
    for (var a = 0; a < seq.audioTracks.numTracks; a++) seq.audioTracks[a].setTargeted(a === trackIndex, true)

    for (var i = gaps.length - 1; i >= 0; i--) {
      seq.setInPoint(gaps[i].start)
      seq.setOutPoint(gaps[i].end)
      qeSeq.extract()
    }

    seq.setInPoint(0)
    seq.setOutPoint(0)

    // Restore full track targeting rather than leaving the timeline narrowed
    // to just the one track this operation cared about.
    for (var v2 = 0; v2 < seq.videoTracks.numTracks; v2++) seq.videoTracks[v2].setTargeted(true, true)
    for (var a2 = 0; a2 < seq.audioTracks.numTracks; a2++) seq.audioTracks[a2].setTargeted(true, true)

    return JSON.stringify({ success: true, gapsRemoved: gaps.length })
  } catch (e) {
    return JSON.stringify({ error: 'JSX error: ' + e.message })
  }
}
