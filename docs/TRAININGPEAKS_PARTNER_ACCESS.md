# Frog Pace — demande d’accès API TrainingPeaks

## Objectif

Frog Pace est une plateforme de coaching d’endurance qui génère des séances structurées à partir du profil, de l’objectif, de l’historique d’entraînement et des retours post-séance de l’athlète.

L’intégration TrainingPeaks sert à envoyer les séances planifiées de Frog Pace vers le calendrier TrainingPeaks de l’athlète afin qu’elles puissent ensuite être synchronisées vers des appareils compatibles, notamment COROS.

## Accès demandé

- `athlete:profile` — récupérer l’identifiant de l’athlète connecté.
- `workouts:plan` — créer et mettre à jour les séances planifiées.
- `workouts:read` — vérifier les séances déjà présentes et éviter les doublons.

## Endpoints utilisés

- OAuth authorize : `https://oauth.trainingpeaks.com/OAuth/Authorize`
- OAuth token : `https://oauth.trainingpeaks.com/oauth/token`
- Athlete profile : `GET https://api.trainingpeaks.com/v1/athlete/profile`
- Create planned workout : `POST https://api.trainingpeaks.com/v2/workouts/plan`
- Update planned workout : `PUT https://api.trainingpeaks.com/v2/workouts/plan/{id}`

## Callback production

`https://frog-pace.vercel.app/api/trainingpeaks/callback`

## Données envoyées

Uniquement les informations nécessaires à la séance planifiée :

- date ;
- sport ;
- titre et consigne ;
- durée / distance ;
- structure détaillée : échauffement, blocs, répétitions, récupérations, retour au calme ;
- cible d’intensité dérivée des repères d’entraînement de l’athlète.

Aucun mot de passe TrainingPeaks n’est collecté par Frog Pace. L’authentification passe exclusivement par OAuth 2.0.

## Sécurité

- HTTPS uniquement.
- OAuth 2.0 à trois acteurs.
- Access token et refresh token stockés chiffrés côté serveur dans Supabase.
- Aucune clé ou token exposé au navigateur.
- RLS et isolation multi-compte côté PostgreSQL.
- Traçabilité de chaque tentative d’export dans `workout_exports`.

## Comportement de synchronisation

- Création initiale : POST du workout.
- Modification future : PUT sur l’identifiant TrainingPeaks enregistré.
- Les séances sont exportées uniquement lorsqu’elles sont marquées `device_export_ready` dans Frog Pace.
- Les adaptations de plan invalident l’ancienne version d’export afin d’empêcher l’envoi d’une structure obsolète.

## Demande

Formulaire officiel : https://api.trainingpeaks.com/request-access

TrainingPeaks indique que l’API est réservée aux développeurs approuvés et qu’elle permet notamment de pousser des séances planifiées sur le calendrier d’un athlète.
