# Deployment — Little Wins

Appen er statisk (ingen PHP i repoet). Push til `main` kører `.github/workflows/deploy.yml`:
først let preflight, derefter `rsync` over SSH til Apache-serveren bag **https://wins.vejnoe.dk**.
HTTPS er en forudsætning — service workers virker ikke over HTTP.

## Nuværende server (verificeret 20. nov. 2026)

| | |
| --- | --- |
| SSH-host | `wins.vejnoe.dk` — domænet bruges bevidst i stedet for serverens IP, da repoet er offentligt |
| SSH-port | Gemmes i `SSH_PORT`-secretet — **skrives aldrig i repoet** |
| Bruger | Gemmes i `SERVER_USER`-secretet — ikke i repoet |
| Web-root | `/web` (set inde fra jalen; symlink `~/web`) |
| Jailkit | Ja. `/usr/bin/rsync` findes; `which`, `sftp` og `python3` findes **ikke** i jalen |
| Rettigheder | Mappen `711`, filer `644` (ejer/gruppe er maskinspecifik og udeladt her) |

Deploy-brugeren er en cPanel **Shell User** med Jailkit-chroot og deler Unix-bruger med den
gamle SFTP-bruger, men har sin egen jail. Nøglelogin er testet og virker via domænet.

`/web/stats` indeholder AWStats-rapporter med egen `.htaccess` og må **aldrig** slettes.
Workflowet ekskluderer (og beskytter dermed mod `--delete`) både `stats/` og `.htaccess`.
Ved tørkørsel var den eneste fjernede fil den forældede `coin.png`; `stats/` var urørt.

## Nøgler og host-verifikation

Deploy-nøglen er en **dedikeret** ed25519-nøgle — ikke den personlige SSH-nøgle:

- Generér: `ssh-keygen -t ed25519 -C "github-actions-wins" -f ~/.ssh/wins_deploy -N ""`
- Den offentlige nøgle (indholdet af `~/.ssh/wins_deploy.pub`) lægges i serverens
  `~/.ssh/authorized_keys` (`600`; `~/.ssh` = `700`). Nøglen selv står ikke her — den er
  ganske vist offentlig, men der er ingen grund til at offentliggøre deploy-nøglen.

Host-nøglerne hentes med `ssh-keyscan -T 10 -p "$SSH_PORT" wins.vejnoe.dk` og gemmes i
`SSH_KNOWN_HOSTS`-secretet — **rå `known_hosts`-linjer, portnummer og fingerprints står
ikke i repoet**. Workflowet bruger `StrictHostKeyChecking=yes` og accepterer kun denne host.
Sammenlign altid fingerprintet med serveren, før secretet sættes.

Den private nøgle må aldrig ligge i repoet.

## Repository secrets

Sættes med `gh secret set <NAVN>` (eller i GitHub: Settings → Secrets and variables → Actions):

| Secret | Værdi |
| --- | --- |
| `SSH_PRIVATE_KEY` | Hele indholdet af `~/.ssh/wins_deploy` |
| `SSH_KNOWN_HOSTS` | Output fra det verificerede `ssh-keyscan` (inkl. `[wins.vejnoe.dk]:<port>`) |
| `SERVER_HOST` | `wins.vejnoe.dk` |
| `SERVER_USER` | Deploy-brugerens navn (hemmeligt) |
| `DEPLOY_PATH` | `/web` |
| `SSH_PORT` | Serverens SSH-port — hemmelig |

## Preflight og deploy

- **Preflight** (kører først, deploy springes over hvis den fejler): `node --check app.js`,
  `python3 -m json.tool manifest.json`, `.github/scripts/check-assets.js` (8 lokale referencer),
  og guards der afviser `little_wins_v2/v3` og `wins-v2/v3` i `app.js`/`sw.js`.
- **Deploy**: `rsync -rlptz --delete` (ikke `-a` — undgår chown-advarsler, da vi ikke er root).
  Kun `actions/checkout@v4` bruges som action — ingen third-party dependencies.
- Automatisk: push til `main`. Manuel: `gh workflow run deploy.yml` (eller Actions → *Run workflow*).
- `workflow_dispatch` findes, så serveren kan synkroniseres igen uden en kodeændring.

## Før første deploy (allerede gjort)

- Backup af `/web` taget lokalt med rsync (652 KB inkl. `stats/`). Gentag før større ændringer:
  ```sh
  rsync -rlptz -e "ssh -p \"$SSH_PORT\" -i ~/.ssh/wins_deploy" \
    <deploy-user>@wins.vejnoe.dk:/web/ <backupmappe>/
  ```
- Tørkørsel af selve deployet:
  `rsync -rlptzvn --delete ... ./ <deploy-user>@wins.vejnoe.dk:/web/`
  — `-n` viser præcis, hvad der ville ske, uden at skrive.

## Verifikation efter deploy

- Actions-loggen grøn; `curl` på `https://wins.vejnoe.dk/manifest.json`, `/sw.js` og `/app.js`.
- `.git/` og `.github/` må **ikke** være tilgængelige via HTTP.
- PWA installeres, service worker registreres, lys/mørk og console uden fejl. Ved SW-opdatering:
  `navigator.serviceWorker.getRegistrations().then(r => r[0] && r[0].update())` og reload to gange.

## Rollback

Lav en revert-commit og push den — så kører workflowet med den gamle kode:
`git revert <commit-sha> && git push`. Det er sikrere end at skifte branch lokalt, fordi `main`
forbliver sande kilde. Se i øvrigt `GIT-WORKFLOW.md`.

## Fejlfinding

- **Actions fejler ved SSH:** tjek `SSH_KNOWN_HOSTS`, `SSH_PORT` og at nøglen ligger på serveren.
- **`which` findes ikke i jalen:** brug `command -v <kommando>` i stedet.
- **Siden viser gammel kode:** service workeren er network-first; opdater og reload to gange.
- **Filer forsvinder fra serveren:** `--delete` fjerner alt, der ikke kommer fra repoet —
  kontroller at `DEPLOY_PATH` peger på appens egen mappe, og at `stats/` stadig er ekskluderet.
