import { Field, LegalLayout, Section } from '@/components/LegalLayout'
import { LEGAL } from '@/services/legal'

/** Mentions légales, as article 6 of the LCEN requires of a published service. */
export function LegalNotice() {
  return (
    <LegalLayout title="Mentions légales">
      <Section title="Éditeur">
        <dl className="grid gap-x-6 gap-y-1 sm:grid-cols-[auto_1fr]">
          <dt className="text-ink-muted">Nom</dt>
          <dd>
            <Field value={LEGAL.publisher} />, personne physique
          </dd>
          <dt className="text-ink-muted">Adresse</dt>
          <dd>
            <Field value={LEGAL.address} />
          </dd>
          <dt className="text-ink-muted">Pays</dt>
          <dd>{LEGAL.country}</dd>
          <dt className="text-ink-muted">Téléphone</dt>
          <dd>
            <Field value={LEGAL.phone} />
          </dd>
          <dt className="text-ink-muted">E-mail</dt>
          <dd>
            {LEGAL.email ? (
              <a href={`mailto:${LEGAL.email}`} className="text-accent underline">
                {LEGAL.email}
              </a>
            ) : (
              <Field value={null} />
            )}
          </dd>
        </dl>
        <p>
          Directeur de la publication : <Field value={LEGAL.publisher} />.
        </p>
      </Section>

      <Section title="Hébergement">
        <p>
          L’interface et le serveur de l’application sont destinés à être hébergés par
          Vercel Inc. et Railway Corporation, aux États-Unis. Les données sont conservées
          chez Neon (base de données), Upstash (sessions et file d’envoi) et Cloudflare
          (pièces jointes). Les coordonnées complètes des hébergeurs retenus sont publiées
          ici lors de la mise en production.
        </p>
      </Section>

      <Section title="Propriété intellectuelle">
        <p>
          Campaign Mailer est un logiciel propriétaire. Son code, son interface et ses
          textes sont protégés ; toute reproduction ou réutilisation sans autorisation
          écrite de l’éditeur est interdite. Les messages, contacts et fichiers que vous
          ajoutez restent les vôtres.
        </p>
      </Section>

      <Section title="Contact">
        <p>
          Pour toute question sur l’application ou sur vos données, écrivez à{' '}
          <Field value={LEGAL.email} />.
        </p>
      </Section>
    </LegalLayout>
  )
}
