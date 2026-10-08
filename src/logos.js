// Les logos des sites, récupérés par le serveur lui-même — jamais par un
// service tiers qui apprendrait la liste des comptes (Google, DuckDuckGo…).
// Une fois récupéré, un logo reste en cache pour tous ; les échecs aussi, pour
// ne pas réessayer en boucle. Le navigateur n'en reçoit jamais les octets du
// site : chaque icône est décodée puis réencodée en PNG par src/image.js
// (jamais de SVG, qui porte du script), et servie sous une politique qui
// interdit tout.
//
// Récupérer une adresse choisie par l'utilisateur, c'est une porte vers le
// réseau interne (SSRF) : seul HTTPS, seulement un nom de domaine public, et
// chaque adresse IP résolue est contrôlée puis épinglée pour la connexion —
// un DNS qui changerait d'avis entre le contrôle et la connexion ne mène nulle part.
import dns from 'node:dns/promises';
import https from 'node:https';
import net from 'node:net';
import { normaliser } from './image.js';

export const DOMAINE = /^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const MAX_IMAGE = 256 * 1024;
const MAX_PAGE = 384 * 1024;
const DELAI = 6000;
const GARDE_OK = 30 * 864e5;
const GARDE_ECHEC = 7 * 864e5;
const PAR_HEURE = 300;

const V4_INTERDITS = [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12],
  ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24],
  ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
];
const v4n = ip => ip.split('.').reduce((n, o) => n * 256 + Number(o), 0);
const dansV4 = (ip, [base, bits]) => Math.floor(v4n(ip) / 2 ** (32 - bits)) === Math.floor(v4n(base) / 2 ** (32 - bits));

function v6Octets(ip) {
  let [tete, queue = ''] = ip.split('::');
  const conv = p => p.split(':').filter(Boolean).flatMap(x => (x.includes('.') ? (() => { const n = v4n(x); return [n >>> 16, n & 0xffff]; })() : [parseInt(x, 16)]));
  const a = conv(tete), b = ip.includes('::') ? conv(queue) : [];
  const mots = ip.includes('::') ? [...a, ...Array(8 - a.length - b.length).fill(0), ...b] : a;
  return mots;
}

/** Une adresse vers laquelle le serveur ne doit jamais se connecter (privée, locale, réservée, documentation…). */
export function adresseInterdite(ip) {
  const s = String(ip || '').replace(/^\[|\]$/g, '').split('%')[0];
  if (net.isIPv4(s)) return V4_INTERDITS.some(r => dansV4(s, r)) || s === '255.255.255.255';
  if (!net.isIPv6(s)) return true;
  const m = v6Octets(s.toLowerCase());
  if (m.length !== 8 || m.some(x => !Number.isInteger(x))) return true;
  const v4De = (hi, lo) => `${hi >>> 8}.${hi & 255}.${lo >>> 8}.${lo & 255}`;
  if (m.slice(0, 5).every(x => x === 0) && (m[5] === 0xffff || m[5] === 0)) return m[5] === 0 && m[6] === 0 && m[7] <= 1 ? true : adresseInterdite(v4De(m[6], m[7]));
  if (m[0] === 0x64 && m[1] === 0xff9b) return adresseInterdite(v4De(m[6], m[7]));        // NAT64
  if (m[0] === 0x2002) return adresseInterdite(v4De(m[1], m[2]));                         // 6to4
  if ((m[0] & 0xfe00) === 0xfc00) return true;                                            // ULA
  if ((m[0] & 0xffc0) === 0xfe80 || (m[0] & 0xffc0) === 0xfec0) return true;              // lien local, site local
  if ((m[0] & 0xff00) === 0xff00) return true;                                            // multidiffusion
  if (m[0] === 0x2001 && (m[1] === 0x0db8 || m[1] < 0x0200)) return true;                // documentation, Teredo, ORCHID…
  if (m[0] === 0x0100 && m[1] === 0 && m[2] === 0 && m[3] === 0) return true;             // rebut
  return false;
}

/** Les icônes déclarées par une page, dans l'ordre où les essayer (les plus grandes d'abord). */
export function iconesDeLaPage(html, base) {
  const out = [];
  for (const m of String(html).matchAll(/<link\b[^>]*>/gi)) {
    const t = m[0];
    const rel = (/\brel\s*=\s*["']?([^"'>]+)/i.exec(t) || [])[1] || '';
    if (!/\b(icon|apple-touch-icon)\b/i.test(rel)) continue;
    const href = (/\bhref\s*=\s*["']([^"']+)["']/i.exec(t) || /\bhref\s*=\s*([^\s>]+)/i.exec(t) || [])[1];
    if (!href || /\.svg(\?|$)/i.test(href) || /^data:/i.test(href)) continue;
    const taille = Number((/\bsizes\s*=\s*["']?(\d+)/i.exec(t) || [])[1] || (/apple-touch/i.test(rel) ? 180 : 32));
    try { out.push({ url: new URL(href, base).href, taille }); } catch { /* adresse illisible */ }
  }
  return out.sort((a, b) => Math.abs(64 - a.taille) - Math.abs(64 - b.taille)).map(x => x.url);
}

export class Logos {
  constructor({ db, actif = true, resoudre = (h) => dns.lookup(h, { all: true, verbatim: true }), requete = https.request, log = console }) {
    Object.assign(this, { db, actif, resoudre, requete, log });
    this.enCours = new Map();
    this.fenetre = { debut: Date.now(), n: 0 };
  }

  /** Une adresse HTTPS d'un domaine public, et l'IP à laquelle se connecter. */
  async cible(adresse) {
    const u = new URL(adresse);
    const hote = u.hostname.toLowerCase();
    if (u.protocol !== 'https:' || u.username || u.password || (u.port && u.port !== '443')) throw new Error('adresse refusée');
    if (net.isIP(hote.replace(/^\[|\]$/g, '')) || !DOMAINE.test(hote)) throw new Error('nom refusé');
    const ips = await this.resoudre(hote);
    if (!ips.length || ips.some(a => adresseInterdite(a.address))) throw new Error('adresse interne refusée');
    return { u, ip: ips[0] };
  }

  /** Une requête GET bornée (taille, délai, redirections), connectée à l'IP contrôlée. */
  async lire(adresse, max, sauts = 3) {
    const { u, ip } = await this.cible(adresse);
    const r = await new Promise((ok, ko) => {
      const req = this.requete({
        host: u.hostname, servername: u.hostname, port: 443, path: u.pathname + u.search, method: 'GET',
        lookup: (_h, _o, cb) => (_o?.all ? cb(null, [ip]) : cb(null, ip.address, ip.family)),
        headers: { 'user-agent': 'SESAME-logos/1.0', accept: 'image/*,text/html;q=0.8', 'accept-encoding': 'identity' },
        timeout: DELAI,
      }, res => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) { res.resume(); return ok({ redirection: new URL(res.headers.location, u).href }); }
        if (res.statusCode !== 200) { res.resume(); return ko(new Error(`HTTP ${res.statusCode}`)); }
        const morceaux = []; let n = 0;
        res.on('data', c => { n += c.length; if (n > max) { req.destroy(new Error('trop gros')); } else morceaux.push(c); });
        res.on('end', () => ok({ corps: Buffer.concat(morceaux), type: String(res.headers['content-type'] || '') }));
        res.on('error', ko);
      });
      req.on('timeout', () => req.destroy(new Error('délai dépassé')));
      req.on('error', ko);
      req.end();
    });
    if (r.redirection) { if (!sauts) throw new Error('trop de redirections'); return this.lire(r.redirection, max, sauts - 1); }
    return r;
  }

  async recuperer(domaine) {
    const essais = [`https://${domaine}/apple-touch-icon.png`, `https://${domaine}/favicon.ico`];
    try {
      const page = await this.lire(`https://${domaine}/`, MAX_PAGE);
      if (/html/i.test(page.type)) essais.unshift(...iconesDeLaPage(page.corps.toString('utf8'), `https://${domaine}/`).slice(0, 3));
    } catch { /* la page ne répond pas : on essaie quand même les adresses habituelles */ }
    for (const a of [...new Set(essais)]) {
      try {
        const png = normaliser((await this.lire(a, MAX_IMAGE)).corps);
        if (png) return { type: 'image/png', octets: png };
      } catch { /* suivant */ }
    }
    return null;
  }

  /** Le logo d'un domaine : du cache, sinon récupéré une fois. null : pas de logo (les initiales restent). */
  async obtenir(domaine) {
    if (!DOMAINE.test(domaine)) return null;
    const l = this.db.prepare('SELECT type, octets, recupere FROM logos WHERE domaine = ?').get(domaine);
    const age = l ? Date.now() - l.recupere : Infinity;
    if (l && (l.type ? age < GARDE_OK : age < GARDE_ECHEC)) return l.type ? { type: l.type, octets: Buffer.from(l.octets) } : null;
    if (!this.actif) return l?.type ? { type: l.type, octets: Buffer.from(l.octets) } : null;
    if (this.enCours.has(domaine)) return this.enCours.get(domaine);
    // Un plafond par heure : le serveur ne devient pas un balayeur du Web.
    if (Date.now() - this.fenetre.debut > 3600e3) this.fenetre = { debut: Date.now(), n: 0 };
    if (++this.fenetre.n > PAR_HEURE) return l?.type ? { type: l.type, octets: Buffer.from(l.octets) } : null;
    const p = this.recuperer(domaine).then(r => {
      this.db.prepare('INSERT INTO logos(domaine, type, octets, recupere) VALUES(?, ?, ?, ?) ON CONFLICT(domaine) DO UPDATE SET type = excluded.type, octets = excluded.octets, recupere = excluded.recupere')
        .run(domaine, r?.type ?? null, r?.octets ?? null, Date.now());
      return r;
    }).catch(() => null)  // jamais le domaine au journal : il dirait chez qui l'on a un compte
      .finally(() => this.enCours.delete(domaine));
    this.enCours.set(domaine, p);
    return p;
  }
}
