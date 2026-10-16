# SA Maps on Google Play (internal testing)

Why: Android Auto 17.x refuses sideloaded apps (`CAR.VALIDATOR: Package DENIED; failed all
other checks`). Apps installed by Google Play — including the private **internal testing**
track (no review, up to 100 testers) — pass that check.

Keep it on **internal testing**. A public release needs the Android Auto quality review and would
expose the GTA-inspired names/theme publicly.

## Files

| What | File |
|---|---|
| App bundle to upload | `android/dist/sa-maps-release.aab` (signed with the upload key) |
| App icon 512×512 | `docs/play/icon-512.png` |
| Feature graphic 1024×500 | `docs/play/feature-graphic.png` |
| Phone screenshots | `docs/play/screenshot-1-places.jpg`, `screenshot-2-navigation.jpg`, `screenshot-3-android-auto.jpg` |
| Privacy policy URL | https://charbelat.github.io/sa-maps/privacy.html |

Upload key: `~/.satools/signing/samaps-upload.jks` + `keystore.properties` (password inside).
**Back both up** somewhere safe (not GitHub). With Play App Signing, Google holds the real app
signing key; if the upload key is ever lost it can be reset from Play Console, but that takes days.

## Store listing (copy/paste)

- **App name:** SA Maps
- **Short description (≤80):** Turn-by-turn navigation on a retro radar, with a two-voice crew reading directions.
- **Full description:**

  > SA Maps is turn-by-turn navigation with the look of a classic open-world game radar.
  >
  > • Full-screen radar map, or a round minimap, with a HUD: clock, next turn, distance and arrival time
  > • Two characters take turns reading your directions in natural voices
  > • Restaurants, cafés, fuel, pharmacies, banks and more, with opening hours and phone numbers
  > • Search that stays in your country and shows the closest places first
  > • Android Auto support with three layouts
  > • Music controls for the app you're already using
  >
  > Map data © OpenStreetMap contributors. Fan-made parody; not affiliated with or endorsed by
  > Rockstar Games or Take-Two Interactive.

- **Category:** Maps & Navigation · **Tags:** navigation
- **Contact email:** your choice (shown on the listing)

## App content answers

- **Privacy policy:** https://charbelat.github.io/sa-maps/privacy.html
- **App access:** All functionality is available without special access (no login).
- **Ads:** No ads.
- **Content rating questionnaire:** category *Utility, Productivity, Communication or Other*;
  answer **Yes** to mild crude humor/profanity (voice lines say "damn"/"shit" unless Clean
  language is on); no violence, no sexual content, no gambling, no user-generated content, no
  location *sharing* with other users.
- **Target audience:** 18 and over.
- **News app:** No. **Government app:** No. **Financial features:** None. **Health:** None.
- **Data safety:**
  - Collects or shares data? **Yes.**
  - Encrypted in transit? **Yes** (all HTTPS). Users can request deletion? **No accounts — nothing tied to a user is stored.**
  - **Location → Approximate + Precise location:** *Collected* (sent to routing/search services to
    compute routes and local results), not shared for ads, **not stored**, processed ephemerally,
    **required** for the app's core purpose (App functionality).
  - **App activity → Other user-generated content / In-app search history:** search text is sent to
    the search service; ephemeral, App functionality.
  - **App info and performance → Crash logs + Diagnostics:** collected (crash reports to our server),
    App functionality / analytics-free bug fixing, not shared.
  - Music info (notification access) **stays on the device** → not collected.
  - Device or other IDs: **not collected.**

## Upload steps (internal testing)

1. **Play Console → Create app**: name *SA Maps*, default language English, *App*, *Free*, accept
   the declarations.
2. **Test and release → Testing → Internal testing → Testers**: create an email list with your
   Google account (and your grader's, if you like). Save.
3. **Internal testing → Create new release**:
   - If asked about **Play App Signing**, keep the default (*Use Google-generated key*).
   - Upload `sa-maps-release.aab`, release name `1.0.0`, notes "First internal build".
   - **Next → Save and publish / Start rollout to Internal testing.**
4. **Android Auto opt-in** (if the console shows it): *Test and release → Advanced settings → Form
   factors → Add form factor → Android Auto*, accept the Android Auto terms, select the internal
   testing track. Internal testing is not reviewed.
5. **Testers tab → Copy link** (the opt-in URL). Open it on the phone **signed in to the tester
   account**, tap *Accept invitation*, then *Download it on Google Play*.
6. **Uninstall the sideloaded SA Maps first** (different signature), then install from Play.
7. Force-stop Android Auto, open **Customise launcher** — SA Maps should now be listed.

Updates: bump `versionCode` in `android/app/build.gradle.kts`, run `gradlew bundleRelease`,
upload the new `.aab` as a new internal release.
