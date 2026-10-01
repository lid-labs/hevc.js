#!/usr/bin/env node
// dev-port 1 — choisit un port de développement libre et lance la commande du projet dessus.
//
// Le numéro de version en en-tête est lu par /mdma-dev-config, qui repère ainsi un dépôt portant
// une version périmée du script. Le changer ici, c'est le changer aussi dans le skill.
//
// Le port est dérivé du projet, du worktree et du rôle : stable d'un lancement à l'autre, distinct
// entre worktrees. Le tirage aléatoire n'est qu'un repli. La doctrine et ses raisons sont dans
// /mdma-dev-config, pas ici.
//
// Usage :
//   node scripts/dev-port.mjs [--role NOM]... [--] COMMANDE [ARG...]
//
// Sans `--role`, le rôle est « web ». Chaque rôle reçoit un port, exporté dans `PORT_<RÔLE>` ;
// avec un rôle unique, il l'est aussi dans `PORT`. Dans les arguments, `{port}` et `{port:<rôle>}`
// sont remplacés par le port — pour les serveurs qui ne lisent pas `PORT`, Vite au premier chef.
//
//   node scripts/dev-port.mjs -- next dev
//   node scripts/dev-port.mjs -- vite --port '{port}'
//   node scripts/dev-port.mjs --role api --role web -- bash scripts/dev.sh
//
// Forcer un port : PORT=4000 npm run dev, ou PORT_API=3001 pour un rôle nommé. Un port imposé mais
// occupé fait échouer le lancement : il n'est jamais remplacé en silence.
//
// Requiert Node 16 ou plus récent.

import { createHash, randomInt } from 'node:crypto'
import { spawn, execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createServer } from 'node:net'
import { constants } from 'node:os'
import { basename, delimiter, dirname, join, resolve } from 'node:path'

// 20000-29999 : au-dessus des ports de service usuels, et sous les plages éphémères du système
// (32768+ sur Linux, 49152+ sur macOS) que l'OS attribue tout seul aux connexions sortantes.
const BLOC_DEBUT = 20000
const BLOC_TAILLE = 10000
const ESSAIS_MAX = 50

const git = (args) => {
  try {
    return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    return null
  }
}

function analyserArguments(argv) {
  const roles = []
  let i = 0

  for (; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--') {
      i++
      break
    }
    if (arg === '--role') {
      const nom = argv[++i]
      if (!nom) throw new Error('--role attend un nom de rôle')
      roles.push(nom)
      continue
    }
    if (arg.startsWith('--role=')) {
      roles.push(arg.slice('--role='.length))
      continue
    }
    if (!arg.startsWith('-')) break // début de la commande, `--` est facultatif
    throw new Error(`option inconnue : ${arg}`)
  }

  const commande = argv.slice(i)
  if (commande.length === 0) throw new Error('aucune commande à lancer (ex. : -- next dev)')
  if (roles.length === 0) roles.push('web')

  const doublon = roles.find((role, rang) => roles.indexOf(role) !== rang)
  if (doublon) throw new Error(`le rôle « ${doublon} » est demandé deux fois`)

  return { roles, commande }
}

// Git passe avant les variables de super.engineering, qui ne servent que de repli hors dépôt :
// quand un projet de l'app est un dossier parent abritant plusieurs dépôts, son
// `SUPER_ENGINEERING_ROOT_PATH` les désigne tous à la fois et les ferait partager une graine.
function identite() {
  // `--git-common-dir` peut répondre un chemin relatif au répertoire courant. `resolve` s'en
  // charge : l'option `--path-format=absolute` qui l'éviterait exige Git 2.31.
  const commun = git(['rev-parse', '--git-common-dir'])
  const sommet = git(['rev-parse', '--show-toplevel'])
  const racine = commun ? dirname(resolve(commun)) : process.env.SUPER_ENGINEERING_ROOT_PATH
  const arbre = sommet ?? process.env.SUPER_ENGINEERING_WORKTREE_PATH
  return {
    projet: basename(racine ?? process.cwd()),
    worktree: basename(arbre ?? process.cwd()),
  }
}

const portDerive = (graine) =>
  BLOC_DEBUT + (createHash('sha256').update(graine).digest().readUInt32BE(0) % BLOC_TAILLE)

// Seul EADDRINUSE veut dire « occupé ». Toute autre erreur — EAFNOSUPPORT ou EADDRNOTAVAIL sur un
// hôte sans IPv6, dans un conteneur par exemple — dit que cette pile n'existe pas ici, pas que le
// port est pris. Les confondre ferait déclarer tous les ports occupés.
const libreSur = (port, hote) =>
  new Promise((resolve) => {
    const sonde = createServer()
    sonde.once('error', (err) => resolve(err.code !== 'EADDRINUSE'))
    sonde.once('listening', () => sonde.close(() => resolve(true)))
    sonde.listen({ port, host: hote, ipv6Only: hote === '::' })
  })

// Les deux piles sont sondées séparément : sur macOS, SO_REUSEADDR laisse coexister un bind sur
// 0.0.0.0 et un bind sur ::, donc sonder une seule famille rend « libre » un port déjà tenu sur
// l'autre — mesuré, un listener IPv4 passait inaperçu.
const estLibre = async (port) => (await libreSur(port, '0.0.0.0')) && (await libreSur(port, '::'))

const variablePourRole = (role) => `PORT_${role.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}`

// `PORT` seul n'est accepté qu'avec un rôle unique : à plusieurs, rien ne dirait à quel service
// l'utilisateur l'a destiné.
function portImpose(role, roleUnique) {
  const cles = roleUnique ? [variablePourRole(role), 'PORT'] : [variablePourRole(role)]
  for (const cle of cles) {
    const brut = process.env[cle]
    if (brut === undefined || brut.trim() === '') continue
    const valeur = Number(brut)
    if (!Number.isInteger(valeur) || valeur < 1 || valeur > 65535) {
      throw new Error(`${cle}=${brut} n'est pas un port valide (entier de 1 à 65535)`)
    }
    return { port: valeur, cle }
  }
  return null
}

async function allouer(roles, projet, worktree) {
  const attribues = new Map()
  const pris = new Set()

  for (const role of roles) {
    const impose = portImpose(role, roles.length === 1)
    if (impose) {
      if (pris.has(impose.port) || !(await estLibre(impose.port))) {
        throw new Error(`le port ${impose.port} demandé par ${impose.cle} est déjà occupé`)
      }
      attribues.set(role, { port: impose.port, origine: `imposé par ${impose.cle}` })
      pris.add(impose.port)
      continue
    }

    const derive = portDerive(`${projet}/${worktree}/${role}`)
    let choisi = !pris.has(derive) && (await estLibre(derive)) ? derive : null
    let origine = 'dérivé du projet'

    for (let essai = 0; choisi === null && essai < ESSAIS_MAX; essai++) {
      const tirage = BLOC_DEBUT + randomInt(BLOC_TAILLE)
      if (!pris.has(tirage) && (await estLibre(tirage))) {
        choisi = tirage
        origine = 'tiré au hasard, le port dérivé était pris'
      }
    }

    if (choisi === null) {
      throw new Error(
        `aucun port libre pour « ${role} » dans ${BLOC_DEBUT}-${BLOC_DEBUT + BLOC_TAILLE - 1} en ${ESSAIS_MAX} essais`,
      )
    }

    attribues.set(role, { port: choisi, origine })
    pris.add(choisi)
  }

  return attribues
}

// `{port}` nu n'est accepté qu'avec un rôle unique. À plusieurs, il désignerait silencieusement
// le premier rôle déclaré, et un ordre changé dans la configuration ferait pointer une commande
// sur le mauvais service sans rien casser de visible.
function substituer(argument, attribues, roleUnique) {
  return argument.replace(/\{port(?::([^}]+))?\}/g, (_, role) => {
    if (!role && !roleUnique) {
      throw new Error('{port} est ambigu avec plusieurs rôles : écrire {port:<rôle>}')
    }
    const cible = role ?? roleUnique
    const attribue = attribues.get(cible)
    if (!attribue) throw new Error(`{port:${cible}} ne correspond à aucun rôle alloué`)
    return String(attribue.port)
  })
}

// `node_modules/.bin` en tête du PATH : npm l'y met pour ses propres scripts, mais pas un appel
// direct au script depuis un terminal, et `-- next dev` échouerait alors en ENOENT.
function cheminAvecBinLocal(sommet) {
  const binLocal = join(sommet ?? process.cwd(), 'node_modules', '.bin')
  const actuel = process.env.PATH ?? ''
  return existsSync(binLocal) ? binLocal + delimiter + actuel : actuel
}

async function main() {
  const { roles, commande } = analyserArguments(process.argv.slice(2))
  const { projet, worktree } = identite()
  const attribues = await allouer(roles, projet, worktree)

  const env = { ...process.env, PATH: cheminAvecBinLocal(git(['rev-parse', '--show-toplevel'])) }
  for (const [role, { port }] of attribues) env[variablePourRole(role)] = String(port)
  if (roles.length === 1) env.PORT = String(attribues.get(roles[0]).port)

  for (const [role, { port, origine }] of attribues) {
    console.log(`${projet} / ${worktree} — ${role} → http://localhost:${port} (${origine})`)
  }

  const roleUnique = roles.length === 1 ? roles[0] : null
  const [programme, ...arguments_] = commande.map((arg) => substituer(arg, attribues, roleUnique))
  const serveur = spawn(programme, arguments_, { stdio: 'inherit', env })

  serveur.once('error', (err) => {
    console.error(`dev-port : impossible de lancer « ${programme} » (${err.code ?? err.message})`)
    process.exit(1)
  })

  // Sans ce relais, un SIGTERM sur ce script le tue et laisse le serveur vivant sur le port —
  // mesuré, c'est ce qui laissait des processus orphelins après chaque arrêt.
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    process.on(signal, () => {
      if (serveur.exitCode === null && !serveur.killed) serveur.kill(signal)
    })
  }

  serveur.on('exit', (code, signal) => {
    process.exit(signal ? 128 + (constants.signals[signal] ?? 15) : (code ?? 0))
  })
}

main().catch((err) => {
  console.error(`dev-port : ${err.message}`)
  process.exit(1)
})
