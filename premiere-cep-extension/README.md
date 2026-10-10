# BijouMusic Cut Silence panel (CEP)

Cuts the silent gaps out of the selected clip. Needs BijouMusic running.

1. Put this folder (named `com.bijoumusic.cutsilence`) in
   - Mac: `~/Library/Application Support/Adobe/CEP/extensions/`
   - Windows: `%APPDATA%\Adobe\CEP\extensions\`
2. Allow unsigned panels.
   - Mac (Terminal): `for v in 9 10 11 12; do defaults write com.adobe.CSXS.$v PlayerDebugMode 1; done; killall cfprefsd`
   - Windows: set the `PlayerDebugMode` string value to `1` under `HKEY_CURRENT_USER\Software\Adobe\CSXS.9` … `CSXS.12`.
3. Restart Premiere. The panel is under Window → Extensions (legacy).
