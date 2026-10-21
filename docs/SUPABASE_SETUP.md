# Activer le mode connecté Supabase — guide pas à pas

Ce guide explique comment passer TRUST AI du mode démonstration au mode
connecté (base partagée + comptes employés). Compte environ 30 minutes.

> **Règle d'or** : ne colle JAMAIS une *secret key*, une *service role key*,
> un mot de passe de base de données ou une URL Postgres directe dans une
> conversation, un fichier du dépôt ou une variable `NEXT_PUBLIC_...`.
> Les deux seules valeurs utilisées par l'application sont **publiques** :
> `Project URL` et `Publishable key`.

## 1. Créer le projet Supabase

1. Va sur <https://supabase.com/dashboard> et connecte-toi.
2. Clique **New project**.
3. Nom : `trust-ai` (ou similaire). Organisation : la tienne.
4. **Région : choisis une région européenne** (ex. *West EU (Paris)* ou
   *Central EU (Frankfurt)*) — les données restent en Europe.
5. Laisse Supabase générer le mot de passe de la base : tu n'en auras pas
   besoin dans l'application. Range-le dans un gestionnaire de mots de passe.

## 2. Récupérer les deux clés publiques

1. Dans le projet : **Settings → API Keys**.
2. Note :
   * **Project URL** (forme `https://xxxx.supabase.co`) ;
   * **Publishable key** (commence par `sb_publishable_...`).
3. Ignore la *secret key* : l'application n'en a pas besoin.

## 3. Configurer en local (sans committer)

À la racine du projet, crée un fichier `.env.local` (il est ignoré par Git) :

```env
NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_xxxx
```

Puis relance `npm run dev`. L'application détecte automatiquement le mode
connecté et affiche la page de connexion.

## 4. Appliquer les migrations

Le schéma complet (tables, contraintes, sécurité RLS, fonctions métier) est
versionné dans `supabase/migrations/`. Ne crée PAS les tables à la main dans
le Dashboard.

### Parcours A — sans rien installer (SQL Editor) ✅ recommandé

Aucun outil à installer, tout se passe dans le navigateur :

1. Ouvre chaque fichier de `supabase/migrations/` sur GitHub (bouton
   **Raw** pour avoir le texte brut) — **dans l'ordre des noms de
   fichiers** (les dates au début des noms donnent l'ordre) ;
2. Copie TOUT le contenu du fichier ;
3. Dashboard Supabase → **SQL Editor** → nouvelle requête → colle →
   **Run** ;
4. Résultat attendu à chaque fois : `Success. No rows returned`. Si une
   erreur rouge apparaît, ARRÊTE-toi et note le message — n'enchaîne pas
   les fichiers suivants.

Puis le référentiel (magasins, dépôts, fournisseurs, extrait de
catalogue) : même procédure avec `supabase/seed.sql`. Le seed ne contient
AUCUNE donnée personnelle et aucun compte : il est sûr.

> Chaque migration ne s'applique qu'UNE fois. En cas de doute (« l'ai-je
> déjà collée ? »), un second Run échoue proprement (« already exists »)
> sans rien casser — note simplement quelles migrations sont passées.

### Parcours B — avec le CLI Supabase (optionnel, pour développeurs)

Si tu travailles depuis un poste avec le projet cloné et que tu préfères
l'outillage en ligne de commande :

```bash
npm install -g supabase   # une seule fois
supabase login            # ouvre le navigateur
supabase link --project-ref XXXX   # "project ref" : Settings → General
supabase db push          # applique les migrations manquantes
supabase db push --include-seed    # + le référentiel (optionnel)
```

> **Migrations déjà appliquées via SQL Editor ?** Le CLI ne le sait pas et
> voudrait tout rejouer. Marque-les d'abord comme appliquées (aucune
> donnée modifiée) : `supabase migration repair --status applied
> <horodatage>` pour chaque fichier déjà passé, puis `supabase db push`.

## 5. Créer le premier utilisateur (toi)

1. Dashboard → **Authentication → Users → Add user → Create new user**.
2. Saisis ton e-mail professionnel et un mot de passe fort.
3. Coche **Auto Confirm User**.

## 6. Transformer ce premier utilisateur en administrateur

Dashboard → **SQL Editor**, puis exécute (remplace uniquement l'e-mail) :

```sql
insert into public.profiles (id, organization_id, display_name, role)
select
  u.id,
  (select id from public.organizations limit 1),
  'Farouk',            -- ton prénom affiché dans l'application
  'administrateur'
from auth.users u
where u.email = 'ton-email@exemple.fr'
on conflict (id) do update set role = 'administrateur', active = true;
```

Cette commande est sûre : elle ne touche qu'à ton profil.

## 7. Désactiver l'inscription publique

Dashboard → **Authentication → Sign In / Providers** :

* Désactive **Allow new users to sign up** (aucune inscription libre) ;
* Garde le provider **Email** activé (nécessaire pour la connexion).

Les comptes employés seront créés par toi (étape 14).

## 8. Configurer les URLs de redirection

Dashboard → **Authentication → URL Configuration** :

* **Site URL** : l'URL principale (aujourd'hui l'URL Vercel, demain
  `https://app.trust-industrie.com`).
* **Redirect URLs** — ajoute les trois :
  * `http://localhost:3000/**`
  * `https://<ton-projet>-*.vercel.app/**` (URL de prévisualisation Vercel)
  * `https://app.trust-industrie.com/**` (futur domaine)

## 9. Ajouter les variables dans Vercel

1. Vercel → ton projet → **Settings → Environment Variables**.
2. Ajoute les DEUX variables, pour **Preview** ET **Production** :
   * `NEXT_PUBLIC_SUPABASE_URL`
   * `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
3. N'ajoute RIEN d'autre (pas de secret key).

## 10. Redéployer et vérifier

1. Vercel → **Deployments → Redeploy** (ou pousse un commit).
2. Ouvre l'application : tu dois être redirigé vers `/connexion`.
3. Connecte-toi avec le compte créé à l'étape 5.
4. Vérifie en bas de la barre latérale : ton nom, ton rôle
   (« Administrateur ») et le bouton de déconnexion.

## 11. Créer les comptes des employés

Pour chaque employé :

1. **Authentication → Users → Add user** (e-mail + mot de passe provisoire,
   Auto Confirm) — ou **Invite user** pour un e-mail d'invitation.
2. **SQL Editor** — crée son profil (adapte e-mail, nom, rôle, magasin) :

```sql
-- Rôles possibles : vendeur, responsable_magasin, achats, logistique,
--                   comptabilite, direction, administrateur
with u as (select id from auth.users where email = 'employe@exemple.fr'),
     s as (select id from public.stores where code = 'HER') -- LIS / HER / AUB
insert into public.profiles (id, organization_id, display_name, role, primary_store_id)
select u.id, (select id from public.organizations limit 1),
       'Prénom Nom', 'vendeur', s.id
from u, s;

-- Magasin(s) autorisé(s) (obligatoire pour vendeur / responsable_magasin)
insert into public.user_store_access (profile_id, store_id)
select u.id, s.id
from (select id from auth.users where email = 'employe@exemple.fr') u,
     (select id from public.stores where code = 'HER') s
on conflict do nothing;
```

3. L'employé se connecte, puis change son mot de passe via
   « Mot de passe oublié » si besoin.

Pour **désactiver** un compte (départ, suspension) :

```sql
update public.profiles set active = false
where id = (select id from auth.users where email = 'employe@exemple.fr');
```

L'accès est coupé immédiatement (vérifié par la sécurité RLS).

## Tests locaux des migrations et de la sécurité (développeurs uniquement)

Cette section est optionnelle et suppose un poste de développement avec
Docker et le CLI Supabase — elle n'est PAS nécessaire pour utiliser
l'application :

```bash
supabase start          # démarre un Supabase local
supabase db reset       # applique migrations + seed sur la base locale
psql "$(supabase db url)" -f supabase/tests/rls_policies.test.sql
```

Le script `supabase/tests/rls_policies.test.sql` vérifie automatiquement :
RLS activée partout, aucun accès anonyme, vendeur limité à son magasin,
identité prise depuis la session, motif obligatoire, auto-validation
interdite, réceptions, comptes désactivés… Il se termine par un ROLLBACK et
ne laisse aucune donnée.

## Retour arrière / dépannage

* **Revenir au mode démonstration** : supprime les deux variables (en local :
  `.env.local` ; sur Vercel : Settings → Environment Variables) puis
  redéploie. Les données Supabase restent intactes, l'application repasse en
  localStorage.
* **« Profil introuvable » après connexion** : le compte Auth existe mais pas
  la ligne `public.profiles` — rejoue l'étape 6 ou 11.
* **« Compte désactivé »** : `update public.profiles set active = true where ...`.
* **Boucle de redirection vers /connexion** : vérifie que les DEUX variables
  sont présentes dans l'environnement Vercel concerné (Preview ET Production
  sont configurés séparément), puis redéploie.
* **Mot de passe oublié sans e-mail reçu** : vérifie les Redirect URLs
  (étape 8) et le dossier spam ; en dernier recours, Dashboard →
  Authentication → Users → « Send password recovery ».
* **Réinitialiser complètement le schéma** (ATTENTION : efface les données
  distantes ; réservé aux utilisateurs du CLI) : `supabase db reset --linked`.

## Étapes ultérieures (hors de ce guide)

* Interface d'administration des utilisateurs dans TRUST AI (nécessitera une
  clé serveur sécurisée, jamais côté navigateur) ;
* connexion Shopify (webhooks) ;
* WhatsApp Business et OpenAI ;
* traitement réel des remboursements/avoirs.
