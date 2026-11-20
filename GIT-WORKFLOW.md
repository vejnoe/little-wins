# Git- og release-workflow — Little Wins

## Grundregel

`main` er produktion: kun færdig, testet kode. `.github/workflows/deploy.yml` deployer **kun**
ved push til `main`. At pushe en anden branch udløser intet deploy — derfor kan man arbejde
og pushe `beta-3` i ro og mag.

`AGENTS.md` gælder i alle branches og worktrees. Se `DEPLOYMENT.md` for server, secrets og rollback.

## Branches og parallelle sessioner

- Lav én branch pr. udgave/feature, fx `beta-3` eller `feature/...`.
- Brug **worktree**, hvis to OpenCode-sessioner skal arbejde samtidig — så overskriver de ikke
  hinandens filer. `AGENTS.md` følger med ind i worktree'et:
  ```sh
  git worktree add -b beta-3 ../little-wins-beta-3 main
  ```
  Start derefter en ny OpenCode-session med worktree-mappen (stien afhænger af din maskine).
- Opret worktree'et fra en **grøn** `main`, så udgangspunktet er kendt godt.

## Sådan laves en ny beta (eksempel: beta-3)

1. Opret branch/worktree fra `main`.
2. Tilføj `beta-3`-posten i `VERSIONS` **først** — det er single source of truth for release notes
   (både opdateringspopppen og versionshistorikken læser herfra).
3. Kun hvis *dataformen* ændres: bump `DATA_VERSION` og tilføj et migrations-trin. Behold gamle
   trin i mindst tre app-versioner; `syncState()` må aldrig ende uden `tasks` eller `days`.
4. Rør aldrig `little_wins_v1` eller `wins-v1` — CI-guarden afviser `v2`/`v3` i de navne.
5. Test lokalt: lys/mørk, touch/desktop, smal skærm, migration af gammel state, console uden fejl.
   Efter kodeændring: opdater service worker og reload **to gange**.
6. Commit i små, beskrivende bidder. Hold branchen kortlivet — merge ofte.

## Release

- Når udgaven er klar:
  ```sh
  git checkout main && git merge beta-3 && git push
  ```
  Det udløser preflight + deploy automatisk.
- Vent med at slette branchen, til Actions er grøn og https://wins.vejnoe.dk er tjekket.
- Opdateringspopppen vises én gang pr. ny version via `appVersion` i `state` — så `VERSIONS`
  skal være opdateret **før** mergen.
- Rollback: `git revert <sha> && git push` (se `DEPLOYMENT.md`).

## GitHub-værktøjer på denne maskine

- `gh` CLI bruges kun til login, oprettelse af repo, secrets og manuel start af workflow.
  **Det er ikke en del af selve deployet** — Actionen kører på GitHubs servere.
- `brew install gh` kan sidde fast ved langsomt net. Alternativ: hent
  `gh_<version>_macOS_arm64.zip` fra GitHub *Releases* og læg binæren i `/usr/local/bin`.
- Uden `gh` kan det samme gøres i browseren: opret repoet, tilføj en SSH-nøgle til GitHub-kontoen,
  og indtast secrets manuelt under *Settings → Secrets and variables → Actions*.
- Repo: `https://github.com/vejnoe/little-wins` (offentligt), remote `origin`. Oprettet 20. nov. 2026.
