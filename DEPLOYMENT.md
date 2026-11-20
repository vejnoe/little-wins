# Deployment — Little Wins

Appen er statisk (ingen PHP i repoet). Push til `main` kører `.github/workflows/deploy.yml`:
først let preflight, derefter `rsync` over SSH til Apache-serveren bag **https://wins.vejnoe.dk**.
HTTPS er en forudsætning — service workers virker ikke over HTTP.

## Serveropsætning (gøres én gang)

1. Opret en dedikeret deploy-bruger og en mappe kun til denne app (fx `/var/www/wins`).
   Brug ikke hele `/var/www/html`, hvis der ligger andre sites dér — `--delete` fjerner
   alt i målmappen, som ikke findes i repoet.
2. Sørg for at deploy-brugeren kan skrive i mappen, og at Apache (`www-data`) kan læse:
   `chown -R <deploy-bruger>:www-data <mappe>` og `chmod -R 750 <mappe>` (eller `a+rX`).
3. Generér en **dedikeret** nøgle til GitHub Actions (ikke din personlige SSH-nøgle):
   `ssh-keygen -t ed25519 -C "github-actions-wins" -f ~/.ssh/wins_deploy` — ingen passphrase.
4. Læg den offentlige nøgle på serveren i `~/.ssh/authorized_keys` for deploy-brugeren
   (`~/.ssh` = `700`, `authorized_keys` = `600`). Test: `ssh -i ~/.ssh/wins_deploy <bruger>@<host>`.
5. Pin serverens host-key. Kør `ssh-keyscan -H <host>` og **verificér fingerprintet**
   (`ssh-keygen -lf <fil>` eller `ssh <host>` og sammenlign), før det gemmes som secret.
   Workflowet bruger `StrictHostKeyChecking=yes` og accepterer kun denne nøgle.
6. Bruger SSH en anden port end 22, gem den i `SSH_PORT`.

## Repository secrets

Sættes med `gh secret set <NAVN>` (eller i GitHub: Settings → Secrets and variables → Actions):

| Secret | Værdi |
| --- | --- |
| `SSH_PRIVATE_KEY` | Hele indholdet af `~/.ssh/wins_deploy` |
| `SSH_KNOWN_HOSTS` | Output fra det verificerede `ssh-keyscan -H <host>` |
| `SERVER_HOST` | Hostnavn/IP uden `ssh://` |
| `SERVER_USER` | SSH-brugeren på serveren |
| `DEPLOY_PATH` | Appens mappe, fx `/var/www/wins` |
| `SSH_PORT` | Valgfri — kun hvis den ikke er 22 |

## Deploy

- Automatisk: push til `main`.
- Manuel: `gh workflow run deploy.yml` (eller Actions → *Deploy to wins.vejnoe.dk* → *Run workflow*).

Preflight tjekker JS-syntax, `manifest.json`, at alle lokale asset-referencer findes, og at
`little_wins_v1`/`wins-v1` ikke er blevet ændret. Deploy jobbet kører kun, hvis preflight er grøn.

## Rollback

Lav en revert-commit og push den — så kører workflowet med den gamle kode:
`git revert <commit-sha> && git push`. Alternativt: checkout en ældre commit lokalt og kør
`gh workflow run deploy.yml`, men revert er sikrere, fordi `main` forbliver sande kilde.

## Fejlfinding

- **Actions fejler ved SSH:** tjek `known_hosts`-secretet, porten og at nøglen ligger på serveren.
- **Siden viser gammel kode:** service workeren er network-first; opdater den med
  `navigator.serviceWorker.getRegistrations().then(r => r[0] && r[0].update())` og reload to gange.
- **Filer forsvinder fra serveren:** `--delete` fjerner alt, der ikke kommer fra repoet —
  kontroller at `DEPLOY_PATH` peger på appens egen mappe. `.git` og `.github` bliver aldrig sendt.
