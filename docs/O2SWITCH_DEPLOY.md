# Frog Pace — déploiement o2switch

Architecture cible : Next.js 15 / Node.js 22 / MariaDB 10.6, sans dépendance Vercel ni Supabase au runtime.

## Base MariaDB

Créer une base et un utilisateur cPanel, puis donner ALL PRIVILEGES à l’utilisateur sur la base.

Importer `database/schema.sql` dans la base vide.

Exemple en terminal (le mot de passe est demandé sans être affiché) :

```bash
mysql -u VOTRE_UTILISATEUR -p VOTRE_BASE < database/schema.sql
```

Sur o2switch, l’hôte MySQL local est `localhost`.

## Variables d’environnement

À créer dans **Setup Node.js App > Add Variable** :

```text
APP_URL=https://frogpace.kumazel.fr
DB_HOST=localhost
DB_PORT=3306
DB_NAME=VOTRE_BASE
DB_USER=VOTRE_UTILISATEUR
DB_PASSWORD=VOTRE_MOT_DE_PASSE
DB_CONNECTION_LIMIT=6
PROVIDER_ENCRYPTION_KEY=64_CARACTERES_HEXADECIMAUX
```

Générer la clé de chiffrement directement sur le serveur et ne jamais la committer :

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

TrainingPeaks est optionnel jusqu’à obtention des identifiants partenaire :

```text
TRAININGPEAKS_CLIENT_ID=
TRAININGPEAKS_CLIENT_SECRET=
```

## Application Node.js

Créer l’application dans **Setup Node.js App** :

```text
Node.js version: 22
Application mode: Production
Application root: frogpace-app
Application URL: frogpace.kumazel.fr
Application startup file: server.js
```

Ne pas placer les sources dans le document root public du sous-domaine.

## Installation

Dans le terminal o2switch, utiliser la commande `source ...` fournie par Setup Node.js App, puis :

```bash
cd ~/frogpace-app
npm install
npm run typecheck
npm run build
```

Enfin, utiliser **Restart** dans Setup Node.js App.

## Git

Branche de migration : `o2switch-full-migration`.

Ne basculer `main` qu’après validation du build et un test réel connexion → onboarding → COROS → activité → plan.
