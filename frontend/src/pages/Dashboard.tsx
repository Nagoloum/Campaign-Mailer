/**
 * The campaign list. Empty until Phase 2 adds campaign creation, so the page
 * says what to expect rather than showing a blank area that reads as a
 * loading failure.
 */
export function Dashboard() {
  return (
    <>
      <h1 className="text-xl font-semibold tracking-tight">Campagnes</h1>

      <div className="mt-6 rounded-xl border border-dashed border-border px-6 py-12 text-center">
        <p className="text-sm font-medium">Aucune campagne pour le moment</p>
        <p className="mx-auto mt-2 max-w-sm text-sm text-ink-muted">
          La création de campagne, l’import de contacts et l’envoi arrivent dans les
          prochaines étapes du projet.
        </p>
      </div>
    </>
  )
}
