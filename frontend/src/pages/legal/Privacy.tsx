import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'

import { Field, LegalLayout, Section } from '@/components/LegalLayout'
import { LEGAL } from '@/services/legal'

function Table({ head, rows }: { head: string[]; rows: ReactNode[][] }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full min-w-xl text-left text-sm">
        <thead className="bg-surface-raised text-ink-muted">
          <tr>
            {head.map((cell) => (
              <th key={cell} className="px-3 py-2 font-medium">
                {cell}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index} className="border-t border-border align-top">
              {row.map((cell, cellIndex) => (
                <td key={cellIndex} className="px-3 py-2">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** Politique de confidentialité. */
export function Privacy() {
  return (
    <LegalLayout title="Politique de confidentialité">
      <Section title="Qui traite vos données">
        <p>
          Le responsable du traitement de vos données de compte est{' '}
          <Field value={LEGAL.publisher} />, éditeur de Campaign Mailer, joignable à{' '}
          <Field value={LEGAL.email} />.
        </p>
        <p>
          Pour les contacts que vous importez, c’est vous qui décidez à qui vous écrivez
          et pourquoi : vous êtes responsable de ce traitement, et l’éditeur agit pour
          votre compte comme sous-traitant, au sens de l’article 28 du RGPD. Il ne les
          utilise à aucune autre fin que l’envoi de vos campagnes.
        </p>
      </Section>

      <Section title="Les données traitées">
        <Table
          head={['Catégorie', 'Données', 'Pourquoi']}
          rows={[
            [
              'Compte',
              'Adresse e-mail et identifiant de votre compte Google ; jetons d’accès Google, chiffrés',
              'Vous connecter et envoyer les e-mails en votre nom',
            ],
            [
              'Campagnes',
              'Nom, objet, message, pièce jointe, rythme d’envoi',
              'Préparer et envoyer vos campagnes',
            ],
            [
              'Contacts importés',
              'Adresse e-mail, nom, entreprise, civilité, statut d’envoi',
              'Envoyer à chacun le message personnalisé',
            ],
            [
              'Journaux',
              'Date et résultat de chaque envoi',
              'Suivre la campagne, éviter tout doublon, respecter les plafonds',
            ],
            [
              'Journal d’audit',
              'Lancement, pause, reprise, export et suppression, avec un identifiant technique',
              'Garder la trace des actions sensibles',
            ],
            [
              'Technique',
              'Cookie de session ; adresse IP, utilisée pour limiter le nombre de requêtes et non conservée',
              'Sécurité du service',
            ],
          ]}
        />
      </Section>

      <Section title="Bases légales">
        <ul className="list-disc space-y-1.5 ps-5">
          <li>
            L’exécution du service que vous demandez en créant un compte (article 6.1.b du
            RGPD) : compte, campagnes, contacts, journaux.
          </li>
          <li>
            L’intérêt légitime de l’éditeur à sécuriser le service et à pouvoir retracer
            les actions sensibles (article 6.1.f) : journal d’audit, limitation des
            requêtes.
          </li>
        </ul>
      </Section>

      <Section title="Durées de conservation">
        <ul className="list-disc space-y-1.5 ps-5">
          <li>
            Compte, campagnes, contacts et pièces jointes : jusqu’à ce que vous les
            supprimiez, ou supprimiez votre compte.
          </li>
          <li>
            Journaux d’envoi et journal d’audit : 12 mois, puis effacement automatique.
          </li>
          <li>Session de connexion : 14 jours au plus.</li>
        </ul>
      </Section>

      <Section title="Sous-traitants et transferts">
        <p>
          Vos données sont traitées par les prestataires suivants, uniquement pour faire
          fonctionner le service :
        </p>
        <Table
          head={['Prestataire', 'Rôle', 'Localisation']}
          rows={[
            ['Google', 'Connexion et envoi des e-mails (API Gmail)', 'États-Unis'],
            ['Neon', 'Base de données', 'États-Unis (Virginie)'],
            ['Upstash', 'Sessions et file d’envoi', 'États-Unis (Virginie)'],
            ['Cloudflare', 'Stockage des pièces jointes', 'États-Unis et réseau mondial'],
            [
              'Vercel, Railway (prévus)',
              'Hébergement de l’interface et du serveur',
              'États-Unis',
            ],
          ]}
        />
        <p>
          Ces transferts hors de l’Union européenne sont encadrés par les garanties que
          ces prestataires proposent, notamment les clauses contractuelles types adoptées
          par la Commission européenne ou leur adhésion au cadre de protection des données
          UE–États-Unis.
        </p>
      </Section>

      <Section title="Données reçues de Google">
        <p>
          L’application demande une seule autorisation sensible,{' '}
          <code className="text-sm">gmail.send</code>, qui lui permet d’envoyer les
          messages que vous avez rédigés, depuis votre compte. Elle ne lit pas, ne modifie
          pas et ne supprime pas le contenu de votre boîte de réception.
        </p>
        <p>
          L’utilisation et le transfert, par Campaign Mailer, d’informations reçues des
          API Google respectent la{' '}
          <a
            href="https://developers.google.com/terms/api-services-user-data-policy"
            target="_blank"
            rel="noreferrer"
            className="text-accent underline"
          >
            Google API Services User Data Policy
          </a>
          , y compris les exigences d’utilisation limitée (Limited Use). Ces informations
          ne servent qu’à fournir le service, ne sont ni vendues ni utilisées à des fins
          publicitaires, et aucune personne ne les consulte, sauf à votre demande, pour la
          sécurité, ou si la loi l’exige.
        </p>
      </Section>

      <Section title="Sécurité">
        <p>
          Les jetons Google sont chiffrés (AES-256-GCM) et ne sont jamais renvoyés ni
          journalisés. Les échanges passent par HTTPS. L’accès aux campagnes et aux
          contacts est strictement limité à leur propriétaire.
        </p>
      </Section>

      <Section title="Cookies">
        <p>
          L’application n’utilise qu’un cookie, <code className="text-sm">cm.sid</code>,
          indispensable pour vous garder connecté. Il n’y a ni cookie publicitaire, ni
          mesure d’audience, ni traceur tiers : aucun consentement n’est donc requis pour
          ce cookie.
        </p>
      </Section>

      <Section title="Vos droits">
        <p>
          Vous disposez d’un droit d’accès, de rectification, d’effacement, de limitation,
          d’opposition et de portabilité de vos données, ainsi que du droit de définir des
          directives sur leur sort après votre décès.
        </p>
        <ul className="list-disc space-y-1.5 ps-5">
          <li>
            Pour obtenir une copie de vos données ou supprimer votre compte, rendez-vous
            sur la page{' '}
            <Link to="/account" className="text-accent underline">
              Mon compte
            </Link>
            .
          </li>
          <li>
            Pour toute autre demande, écrivez à <Field value={LEGAL.email} />. Une réponse
            vous est apportée dans un délai d’un mois.
          </li>
          <li>
            Si vous estimez que vos droits ne sont pas respectés, vous pouvez adresser une
            réclamation à la CNIL (
            <a
              href="https://www.cnil.fr"
              target="_blank"
              rel="noreferrer"
              className="text-accent underline"
            >
              cnil.fr
            </a>
            ).
          </li>
        </ul>
        <p>
          Si vous êtes un contact ayant reçu un message envoyé avec Campaign Mailer,
          adressez votre demande en priorité à l’expéditeur, qui est responsable de ce
          traitement ; l’éditeur la lui transmettra si vous le contactez.
        </p>
      </Section>
    </LegalLayout>
  )
}
