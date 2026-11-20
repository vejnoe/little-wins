# KNOWN-ISSUES — Little Wins

Kendte fejl, begrænsninger og faldgruber. Opdateret 20. nov. 2026.

## Begrænsninger
- **Ingen cloud-sync.** Det, vi kalder "sync", er lokal skema-migration (`syncState()` i `app.js`),
  ikke synkronisering mellem enheder. Opgaver ligger kun i `localStorage` på den enkelte enhed.
  Slet aldrig nøglen `little_wins_v1`.
- **Opdateringspopuppen er lokal.** Den styres af `appVersion` i state — ikke af service workerens
  `update`-event. Den vises én gang pr. ny version; ved en opdatering helt offline kan den udeblive.
- **Release notes er manuelle.** `VERSIONS`-arrayet vedligeholdes for hånd; der er ingen automatisk
  changelog fra Git.
- **Ingen automatiseret testsuite.** Der testes manuelt i browseren: lys/mørk, touch/desktop,
  smal skærm, migration af gammel state og console for fejl.

## Faldgruber ved test
- **Count-up kan vise et mellemtal i tests.** Skiftes `localStorage` hurtigt, mens `animateTotal()`
  kører, kan et gammelt `requestAnimationFrame`-frame blive hængende (set som fx "583.280").
  Ikke reproduceret i normal brug — vent ≥1,2 s før aflæsning af `#total-points` i en test.
- **Service worker serverer gamle filer.** Efter hver kodeændring:
  `navigator.serviceWorker.getRegistrations().then(r => r[0] && r[0].update())` og reload **to gange**.
- **PHP-serveren kan gå ned.** Genstart:
  `cd "<projektmappen>" && nohup php -S 0.0.0.0:8000 > /tmp/php-server.log 2>&1 & echo $! > /tmp/php-server.pid`
- **Screenshots** via browser-værktøjet kræver `browser.tabs.focus` og en synlig desktop-fane.

## Data og migration
- `DATA_VERSION = 2`. Trin `0` og `1` i `MIGRATIONS` skal bevares i **mindst tre app-versioner endnu**:
  beta-testere opgraderer lokalt og må aldrig miste opgaver.
- Migration v1 → v2: `max` bliver til `points`, `simpleMode` fjernes, åbne dage får opgavens
  pointværdi, gennemførte dage beholder det faktisk optjente beløb.
- Redigering af en opgaves `points` opdaterer kun **åbne** dage — historikken forbliver uændret.

## Assets — nuværende status
- `icon-192.png` (192×192), `icon-512.png` (512×512) og `happy-coin.png` (256×256) er regenereret
  som korrekte PNG'er. De tidligere filer havde forkerke dimensioner/format. Ændringerne er committet.
- Den gamle, ubrugte `coin.png` er slettet; der findes ingen tilbageværende referencer til den.
- `sfx/super-mario-world-multiple-coins.mp3` ligger stadig i repoet, men **bruges ikke** — kun
  single-klippet preloades og indgår i de fem lydvarianter. Beholdt indtil andet besluttes.

## Ikke fuldført
- Let preflight i CI (se `.github/workflows/deploy.yml`), men ingen rigtig testsuite.
- Ingen server-side backup ud over manuel JSON-eksport/import. Se `DEPLOYMENT.md` for deploy og rollback.
- Ingen designkilde (Figma) i repoet — designet vedligeholdes direkte via CSS-tokens.
