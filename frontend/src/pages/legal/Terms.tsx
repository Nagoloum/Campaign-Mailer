import { Link } from 'react-router-dom'

import { Field, LegalLayout, Section } from '@/components/LegalLayout'
import { LEGAL } from '@/services/legal'

/** Conditions générales d'utilisation. */
export function Terms() {
  return (
    <LegalLayout title="Conditions générales d’utilisation">
      <Section title="1. Objet">
        <p>
          Campaign Mailer permet d’envoyer, depuis votre propre compte Gmail, une série
          d’e-mails personnalisés à une liste de contacts que vous importez, à un rythme
          que vous choisissez. Les présentes conditions encadrent l’utilisation de ce
          service, édité par <Field value={LEGAL.publisher} />.
        </p>
        <p>
          En créant un compte, vous acceptez ces conditions et la{' '}
          <Link to="/legal/confidentialite" className="text-accent underline">
            politique de confidentialité
          </Link>
          .
        </p>
      </Section>

      <Section title="2. Accès au service">
        <p>
          Le service est réservé aux personnes majeures. La connexion se fait avec un
          compte Google : vous autorisez l’application à envoyer des e-mails en votre nom.
          Elle ne peut pas lire votre boîte de réception. Vous pouvez retirer cette
          autorisation à tout moment, depuis la page « Mon compte » ou depuis votre compte
          Google.
        </p>
      </Section>

      <Section title="3. Fonctionnement et limites">
        <ul className="list-disc space-y-1.5 ps-5">
          <li>Les messages partent de votre compte Gmail, un par un.</li>
          <li>
            L’application limite chaque compte à 450 envois sur 24 heures, toutes
            campagnes confondues, en dessous de la limite de 500 fixée par Google pour un
            compte personnel. Au moins 10 secondes séparent deux envois.
          </li>
          <li>
            Un message parti ne peut pas être rappelé. Relisez l’aperçu avant de lancer
            une campagne.
          </li>
          <li>
            L’application ne garantit ni la remise des messages en boîte de réception, ni
            une réponse de vos destinataires : cela dépend des messageries de ceux-ci et
            de la réputation de votre compte.
          </li>
        </ul>
      </Section>

      <Section title="4. Vos engagements">
        <p>Vous êtes seul responsable des messages que vous envoyez. En particulier :</p>
        <ul className="list-disc space-y-1.5 ps-5">
          <li>
            vous n’écrivez qu’à des personnes que vous avez une raison légitime de
            contacter, dans le respect de la réglementation sur la prospection et la
            protection des données (RGPD, Code des postes et des communications
            électroniques) ;
          </li>
          <li>
            pour les contacts que vous importez, vous êtes responsable du traitement de
            leurs données : vous devez pouvoir justifier d’une base légale, les informer
            et respecter leurs droits, notamment leur demande de ne plus être contactés ;
          </li>
          <li>
            vous n’envoyez ni message non sollicité en masse, ni contenu illicite,
            trompeur ou portant atteinte aux droits d’autrui ;
          </li>
          <li>vous respectez les conditions d’utilisation de Google et de Gmail.</li>
        </ul>
      </Section>

      <Section title="5. Données personnelles">
        <p>
          Le traitement de vos données, et de celles de vos contacts pour lesquelles
          l’éditeur agit comme sous-traitant, est décrit dans la{' '}
          <Link to="/legal/confidentialite" className="text-accent underline">
            politique de confidentialité
          </Link>
          . Vous pouvez à tout moment télécharger vos données ou supprimer votre compte
          depuis la page « Mon compte ».
        </p>
      </Section>

      <Section title="6. Disponibilité et responsabilité">
        <p>
          Le service est fourni en l’état. L’éditeur s’efforce d’en assurer la
          disponibilité et la sécurité, sans pouvoir garantir une absence totale
          d’interruption ou d’erreur. Il ne saurait être tenu responsable d’une suspension
          de votre compte Google, d’une plainte d’un destinataire ou de toute conséquence
          d’un message que vous avez envoyé, sauf faute de sa part. Rien dans ces
          conditions ne limite les droits que la loi vous garantit en tant que
          consommateur.
        </p>
      </Section>

      <Section title="7. Suspension et fin du service">
        <p>
          Vous pouvez supprimer votre compte à tout moment ; toutes vos données sont alors
          effacées. L’éditeur peut suspendre un compte utilisé en violation de ces
          conditions, notamment pour des envois abusifs, après vous en avoir informé
          lorsque c’est possible.
        </p>
      </Section>

      <Section title="8. Modification des conditions">
        <p>
          Ces conditions peuvent évoluer. Une nouvelle version vous est présentée à votre
          connexion suivante, et l’utilisation du service suppose de l’accepter.
        </p>
      </Section>

      <Section title="9. Droit applicable">
        <p>
          Ces conditions sont soumises au droit français. En cas de litige, une solution
          amiable sera recherchée en priorité ; à défaut, les tribunaux français sont
          compétents, sous réserve des règles impératives applicables aux consommateurs.
        </p>
      </Section>

      <Section title="10. Contact">
        <p>
          <Field value={LEGAL.publisher} />, <Field value={LEGAL.email} />.
        </p>
      </Section>
    </LegalLayout>
  )
}
