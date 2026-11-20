# AGENTS.md — Little Wins

Kendte fejl, begrænsninger og test-faldgruber står i `KNOWN-ISSUES.md`.
Server, SSH-nøgler, secrets, deploy og rollback står i `DEPLOYMENT.md`.
Branches, worktrees og release-flow står i `GIT-WORKFLOW.md`.

## Produktet
Installerbar PWA til daglige "små sejre" med point. Dansk UI, datoer som `onsdag 18. nov.`.
Kører lokalt via PHP på `0.0.0.0:8000`. Gemt data ligger i `localStorage` under `little_wins_v1`,
service worker-cachen hedder `wins-v1`. Der findes **aktive beta-testere**.

## Arkitektur
- `app.js` — én IIFE. `state` er det eneste persisterede data. Al rendering sker i `render*()`-funktioner.
  Ingen inline styles eller farvekoder her.
- `index.html` — kun struktur og ID'er. Ingen inline CSS/JS, ingen udkommenterede blokke.
- `style.css` — **design tokens først** i `:root`, derefter komponenter i nummererede sektioner.
  Dark mode er udelukkende token-overrides.
- `sw.js` / `manifest.json` — network-first, `skipWaiting()`. Brug aldrig `v2`/`v3` i storage- eller cachenavne.
- `sfx/` — ét mønt-klip. Preloades og decodedes ved opstart i `soundBank`; `playCoinSound()` laver
  fem varianter med pitch og lag ud fra det samme `coinCount()`, der styrer partiklerne.
- Point er en fast værdi pr. opgave (`points`), sat ved oprettelse/redigering. Der findes **ikke**
  en daglig skyder og ingen visningstilstand. Underopgaver (`task.subtasks`, hver med `id` og `title`)
  er de **eneste** andele — der findes ingen hoved-checkbox. To underopgaver = to ting at løse.
  Overskuddet ved afrunding gives til de første underopgaver, så alle krydser tilsammen giver
  præcis opgavens beløb. Opgaven er færdig, når alle underopgaver er checket (`record.done` sættes
  automatisk). Dagens afkrydsninger gemmes i `record.subs` og nulstilles med dagen. Der er kun ét
  niveau — ingen indlejring og ingen træk mellem opgaver.

## Koderegler
1. **Én kilde til sandhed.** Farver, fonte, størrelser og release notes defineres ét sted
   (CSS-tokens / `VERSIONS`-arrayet). Gentag aldrig en værdi i en komponentregel.
2. **Tjek alle steder før du retter.** En knapfarve kan ligge i basisreglen, `:hover`, dark mode,
   en media query **og** i JS (fx `theme-color`). Søg i alle filer før du antager, at det er ét sted.
   Kunden beder om et *resultat*, ikke om en bestemt linje — find alle berørte steder selv.
3. **Bagudkompatibilitet — minimum 3 versioner.** Nulstil aldrig `localStorage`, skift aldrig
   storage-key, og slet aldrig `tasks` eller `days`. Ved enhver ændring af gemt datas form:
   bump `DATA_VERSION`, tilføj et trin i `MIGRATIONS`, og lad `syncState()` køre automatisk fra
   `load()` og `importData()`. Behold gamle migrations-trin i mindst tre app-versioner.
4. **Migrering må aldrig miste data.** `syncState()` afviser en migration, der ender uden `tasks`
   eller `days`, og beholder i stedet den originale state. Test altid ændringer med en gammel backup.
5. **Genbrug byggeklodser.** `makeRangeControl`, `buildCardHead/Right/Actions`, `buildTaskCard`,
   modal-systemet og `VERSIONS` skal udvides — ikke kopieres.
6. **View-state vs. data.** Kun `state` gemmes. Midlertidige flags (`showLogged`, `historyOffset`,
   `justCompletedId`) er modulvariabler.
7. **Touch og desktop er lige vigtige.** Detektér med `matchMedia('(hover: none)')` og understøt
   begge veje. Ingen bekræftelse ved fortryd; "Log gennemførte" er en eksplicit handling.
8. **Professionelt, ikke slub.** Ingen død CSS, ingen magic numbers, ingen duplikerede tekster.
   Nye konstanter og migrationstrin får en kort kommentar, der forklarer hvorfor de findes.
9. **Lyd følger animationen.** Nye klip preloades ved opstart, tilføjes til SW's `ASSETS` og tilpasses
   animationens varighed — aldrig heap-fetch i selve klik-handlingen.

## Sådan tilføjer du en funktion
1. Læs de relevante dele af `app.js`, `index.html` og `style.css` først — antag ingenting.
2. Opdater tokens/data først, derefter komponenterne der bruger dem.
3. Påvirkes gemt data? Tilføj migrationstrin og test med state fra en ældre beta.
4. Test i browseren: lys/mørk, touch/desktop, smal skærm, og tjek console for fejl.
5. Commit med en beskrivende besked. Repoet skal være rent bagefter.
