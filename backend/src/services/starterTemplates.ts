/**
 * Templates offered when a campaign is created.
 *
 * They exist because the blank page is where most campaigns die, and because
 * the first draft a user writes tends to be three paragraphs about themselves.
 * Each one is short, names one reason for writing, and ends with a single ask
 * that costs the reader little to grant.
 *
 * Every variable carries a fallback. A CSV is never as complete as the person
 * importing it believes, and `Bonjour ,` is worse than no merge at all.
 */

export interface StarterTemplate {
  id: string
  name: string
  /** What the template is for, shown in the picker. */
  description: string
  subject: string
  bodyText: string
  bodyHtml: string
}

export const STARTER_TEMPLATES: readonly StarterTemplate[] = [
  {
    id: 'candidature-spontanee',
    name: 'Candidature spontanée',
    description:
      'Pour postuler dans une entreprise qui ne recrute pas publiquement. Court, précis, une seule demande.',
    subject: 'Candidature — {{company_name|votre équipe}}',
    bodyText: `Bonjour {{salutation|Madame, Monsieur}},

Je me permets de vous écrire directement : je cherche un poste de [VOTRE POSTE] et {{company_name|votre entreprise}} fait partie des rares équipes sur [CE QUI VOUS INTÉRESSE PRÉCISÉMENT] que je suis depuis un moment.

En deux lignes : [VOTRE EXPÉRIENCE EN UNE PHRASE]. Mon CV est en pièce jointe.

Auriez-vous quinze minutes dans les prochaines semaines pour en parler ? Si ce n'est pas le bon moment, je comprendrai tout à fait.

Bien cordialement,
[VOTRE NOM]
[VOTRE TÉLÉPHONE]`,
    bodyHtml: `<p>Bonjour {{salutation|Madame, Monsieur}},</p>
<p>Je me permets de vous écrire directement : je cherche un poste de [VOTRE POSTE] et {{company_name|votre entreprise}} fait partie des rares équipes sur [CE QUI VOUS INTÉRESSE PRÉCISÉMENT] que je suis depuis un moment.</p>
<p>En deux lignes : [VOTRE EXPÉRIENCE EN UNE PHRASE]. Mon CV est en pièce jointe.</p>
<p>Auriez-vous quinze minutes dans les prochaines semaines pour en parler ? Si ce n'est pas le bon moment, je comprendrai tout à fait.</p>
<p>Bien cordialement,<br />[VOTRE NOM]<br />[VOTRE TÉLÉPHONE]</p>`,
  },
  {
    id: 'prospection-b2b',
    name: 'Prospection B2B',
    description:
      'Pour un premier contact commercial. Part du problème du destinataire, pas de votre produit.',
    subject: '{{company_name|Votre équipe}} et [LE PROBLÈME EN TROIS MOTS]',
    bodyText: `Bonjour {{contact_name|à vous}},

J'ai vu que {{company_name|votre entreprise}} [CE QUE VOUS AVEZ REMARQUÉ — un recrutement, une annonce, une page du site]. C'est souvent le moment où [LE PROBLÈME QUE VOUS RÉSOLVEZ] devient pénible.

Nous aidons [TYPE D'ENTREPRISE COMPARABLE] à [RÉSULTAT CONCRET, avec un chiffre si vous en avez un].

Est-ce un sujet chez vous en ce moment ? Un simple oui ou non me suffit.

Bonne journée,
[VOTRE NOM]
[VOTRE ENTREPRISE]`,
    bodyHtml: `<p>Bonjour {{contact_name|à vous}},</p>
<p>J'ai vu que {{company_name|votre entreprise}} [CE QUE VOUS AVEZ REMARQUÉ — un recrutement, une annonce, une page du site]. C'est souvent le moment où [LE PROBLÈME QUE VOUS RÉSOLVEZ] devient pénible.</p>
<p>Nous aidons [TYPE D'ENTREPRISE COMPARABLE] à [RÉSULTAT CONCRET, avec un chiffre si vous en avez un].</p>
<p>Est-ce un sujet chez vous en ce moment ? Un simple oui ou non me suffit.</p>
<p>Bonne journée,<br />[VOTRE NOM]<br />[VOTRE ENTREPRISE]</p>`,
  },
  {
    id: 'relance',
    name: 'Relance',
    description:
      'À envoyer une semaine après un premier message resté sans réponse. Ne reproche rien et donne une porte de sortie.',
    subject: 'Re : [REPRENEZ L’OBJET DU PREMIER MESSAGE]',
    bodyText: `Bonjour {{contact_name|à vous}},

Je remonte mon message précédent, au cas où il serait passé au mauvais moment.

Pour rappel, en une phrase : [VOTRE DEMANDE, PLUS COURTE QUE LA PREMIÈRE FOIS].

Si le sujet n'est pas d'actualité, dites-le moi simplement et je n'insisterai plus.

Bien à vous,
[VOTRE NOM]`,
    bodyHtml: `<p>Bonjour {{contact_name|à vous}},</p>
<p>Je remonte mon message précédent, au cas où il serait passé au mauvais moment.</p>
<p>Pour rappel, en une phrase : [VOTRE DEMANDE, PLUS COURTE QUE LA PREMIÈRE FOIS].</p>
<p>Si le sujet n'est pas d'actualité, dites-le moi simplement et je n'insisterai plus.</p>
<p>Bien à vous,<br />[VOTRE NOM]</p>`,
  },
]
