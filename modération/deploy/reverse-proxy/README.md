# Reverse proxy pour le serveur de vérification

But : **cacher l'IP de Pebble** derrière un VPS qui sert de point d'entrée HTTPS pour le site de vérif. Les visiteurs voient l'IP du VPS, jamais celle du serveur Pebble. Le bot Pebble vérifie en plus un **secret partagé** dans les requêtes pour refuser tout accès direct si quelqu'un découvre l'IP de Pebble.

## 🏗️ Architecture

```
   Visiteur Discord
        │  HTTPS https://verif.tondomaine.com
        ▼
   ┌────────────────────────┐
   │   VPS (Oracle Free,    │   ← IP publique = celle du VPS
   │   Hetzner, etc.)       │
   │   Caddy reverse proxy  │
   └──────────┬─────────────┘
              │  HTTP + header X-Verif-Proxy-Secret
              ▼
   ┌────────────────────────┐
   │  Pebble Host           │   ← IP cachée, accepte uniquement
   │  bot Discord + verif   │     si le secret matche
   │  port 3782             │
   └────────────────────────┘
```

## 📋 Prérequis

- [ ] Un **domaine** que tu contrôles (Cloudflare DNS gratuit fonctionne très bien)
- [ ] Un **VPS** quelque part — Oracle Cloud Free Tier marche très bien (gratuit à vie, 1 vCPU + 1 Go RAM = largement assez pour ce proxy)
- [ ] L'**IP publique de Pebble** (celle du panel) — visible dans le panel Pebble
- [ ] Le **port HTTP du bot** ouvert côté Pebble (par défaut `3782`, var `HTTP_PORT`)

## 🚀 Setup (5 minutes)

### 1. Pointe ton DNS vers le VPS

Sur ton registrar / Cloudflare :

```
Type : A
Nom  : verif
Valeur : <IP de ton VPS>
TTL  : Auto
Proxy : Désactivé (nuage gris) — tu peux activer plus tard si tu veux double couche
```

→ Vérifie avec `nslookup verif.tondomaine.com` que ça pointe bien sur ton VPS.

### 2. Lance le script de setup sur le VPS

SSH sur ton VPS (par défaut `ubuntu@<IP>` sur Oracle), puis :

```bash
# Génère un secret long et aléatoire (à copier précieusement)
SECRET=$(openssl rand -hex 32)
echo "Secret généré : $SECRET"

# Télécharge le script
wget https://raw.githubusercontent.com/<TON_REPO>/main/modération/deploy/reverse-proxy/setup-vps.sh
chmod +x setup-vps.sh

# Lance avec tes valeurs
sudo DOMAIN=verif.tondomaine.com \
     PEBBLE_IP=<IP_DE_TON_PEBBLE> \
     PEBBLE_PORT=3782 \
     SECRET="$SECRET" \
     ./setup-vps.sh
```

Le script :
- Installe Docker
- Génère le `Caddyfile` avec tes valeurs
- Configure le firewall (ports 22, 80, 443)
- Démarre Caddy en container
- T'imprime le secret à coller côté Pebble

### 3. Colle les variables côté Pebble

Dans le `.env` du bot modération sur Pebble (panel → Files → `.env`) :

```env
# URL publique vue par les visiteurs (Caddy gère le HTTPS)
PUBLIC_BASE_URL=https://verif.tondomaine.com

# Port HTTP local du bot — INCHANGÉ
HTTP_PORT=3782

# Secret partagé : SEUL ton VPS (Caddy) connaît cette valeur, donc seul lui
# peut hit le bot. Tout le reste reçoit un 403.
VERIFY_PROXY_SECRET=<le_secret_du_script>

# Optionnel : si tu préfères whitelist par IP au lieu du secret (mais le secret
# est plus robuste car résistant au IP spoofing).
# VERIFY_PROXY_IPS=<IP_DU_VPS>
```

Sauvegarde et **redémarre le bot** côté panel Pebble.

### 4. Test

```bash
# Depuis n'importe où — doit marcher
curl https://verif.tondomaine.com/health
# → "ok"

# Tente de hit Pebble en direct (depuis ton PC) — doit être refusé
curl http://<IP_PEBBLE>:3782/health
# → "Forbidden" (parce que pas de header secret)

# Test complet : lance /verify dans Discord
# Le DM contient maintenant l'URL https://verif.tondomaine.com/verify/start?state=...
```

Si `/health` répond `ok` via HTTPS et `Forbidden` en direct sur Pebble, **tu es bon**.

## 🔧 Maintenance

### Voir les logs

```bash
# Logs Caddy en temps réel
ssh ubuntu@<VPS>
docker compose -f /opt/verif-proxy/docker-compose.yml logs -f

# Logs fichier (rotated auto)
tail -f /var/log/caddy/verif.log
```

### Update Caddy

```bash
cd /opt/verif-proxy
docker compose pull
docker compose up -d
```

### Changer le secret (rotation)

```bash
# 1. Génère un nouveau secret
NEW=$(openssl rand -hex 32)

# 2. Mets-le dans le .env Pebble + redémarre le bot
# 3. Édite /opt/verif-proxy/Caddyfile, remplace l'ancien secret par le nouveau
sudo sed -i "s/X-Verif-Proxy-Secret \".*\"/X-Verif-Proxy-Secret \"$NEW\"/" /opt/verif-proxy/Caddyfile

# 4. Recharge Caddy (sans downtime)
docker compose -f /opt/verif-proxy/docker-compose.yml exec caddy caddy reload --config /etc/caddy/Caddyfile
```

### Désactiver le proxy temporairement

```bash
sudo docker compose -f /opt/verif-proxy/docker-compose.yml down
```

Tant que c'est down, le site de vérif est inaccessible (les liens DM mènent à un timeout). Mais le bot Discord continue de tourner normalement sur Pebble.

## 🚨 Sécurité

### Ce qui est protégé

- ✅ L'IP de Pebble n'apparaît **jamais** dans les requêtes des visiteurs
- ✅ Si quelqu'un trouve l'IP de Pebble (via une fuite ailleurs), il ne peut **pas** hit le bot — réponse 403 sans le secret
- ✅ HTTPS auto avec certif Let's Encrypt renouvelé automatiquement
- ✅ Headers de sécurité (HSTS, anti-clickjacking, no-referrer)
- ✅ Anti-indexation moteurs de recherche (`noindex`)

### Ce qui reste exposé

- ⚠️ Le port `3782` de Pebble est toujours ouvert côté réseau (mais le 403 protège l'accès)
- ⚠️ Si quelqu'un découvre TON SECRET (il fuite par log, screenshot, etc.), il peut hit Pebble en direct → **rotate le secret**
- ⚠️ L'IP du VPS est publique — c'est lui qui mange les éventuels DDoS, pas Pebble. Active le proxy Cloudflare orange devant pour double couche

### Renforcement optionnel

Pour blinder encore plus, **double couche Cloudflare** :

1. Sur Cloudflare DNS, active le proxy orange sur `verif.tondomaine.com`
2. Le visiteur voit l'IP Cloudflare → IP VPS → IP Pebble (chacun protège le suivant)
3. Tu gagnes la protection DDoS / WAF Cloudflare gratuite

## 📁 Fichiers

| Fichier | Rôle |
|---|---|
| `Caddyfile` | Config Caddy à éditer puis poser sur le VPS dans `/opt/verif-proxy/` |
| `nginx.conf` | Alternative nginx si tu préfères (à mettre dans `/etc/nginx/sites-available/`) |
| `docker-compose.yml` | Lance Caddy en container Docker |
| `setup-vps.sh` | Script d'install one-shot sur Ubuntu fresh |
| `README.md` | Ce fichier |

## ❓ FAQ

**Pourquoi pas Cloudflare Tunnel direct ?**
Plus propre encore (zéro port ouvert sur Pebble), mais nécessite d'installer `cloudflared` sur Pebble — pas toujours possible selon le plan d'hébergement. Le reverse proxy via VPS marche partout.

**Combien coûte le VPS ?**
- **Oracle Cloud Free Tier** : 0 € à vie (4 vCPU ARM + 24 Go RAM gratuits, largement assez)
- **Hetzner CX11** : 4,15 €/mois
- **DigitalOcean basic** : 4 $/mois

Caddy + ce setup consomme ~30 Mo RAM, donc le moindre VPS gratuit suffit.

**Mon VPS est-il vulnérable ?**
Caddy est un des serveurs HTTPS les plus sécurisés du marché. Le seul service exposé c'est lui. Garde Ubuntu à jour avec `apt update && apt upgrade` régulièrement.

**Combien de temps pour le HTTPS la première fois ?**
~30 secondes après le démarrage de Caddy. Si le DNS pointe bien, Let's Encrypt délivre le certif sans intervention. Vérifie avec `curl https://verif.tondomaine.com/health` — si `ok`, c'est bon.
