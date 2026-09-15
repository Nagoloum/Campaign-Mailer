import { expect, test } from '@playwright/test'

import { API_URL } from './playwright.config'

/**
 * The journey the product exists for: sign in, prepare a campaign, import the
 * contacts, launch, and follow it until every message has gone.
 */

const CSV = [
  'email,nom,entreprise',
  'ana@example.test,Ana,Acme',
  'pas-une-adresse,X,Y',
  'bob@example.test,Bob,Globex',
].join('\n')

test('a user prepares a campaign, launches it and follows it to the end', async ({
  page,
  context,
  request,
}) => {
  // Sign-in: the session Google would have opened.
  const session = (await (await request.post(`${API_URL}/e2e/session`)).json()) as {
    name: string
    value: string
  }
  await context.addCookies([
    { ...session, domain: 'localhost', path: '/', httpOnly: true, sameSite: 'Lax' },
  ])

  await page.goto('/')

  await test.step('accepts the terms at first sign-in', async () => {
    await page.getByRole('checkbox', { name: /J’ai lu et j’accepte/ }).check()
    await page.getByRole('button', { name: 'Accepter et continuer' }).click()
  })

  await test.step('creates a campaign and writes its message', async () => {
    await page.getByRole('link', { name: 'Nouvelle campagne' }).click()
    await page.getByLabel('Nom de la campagne').fill('Candidatures E2E')
    await page.getByRole('button', { name: 'Créer la campagne' }).click()

    await expect(
      page.getByRole('heading', { level: 1, name: 'Candidatures E2E' }),
    ).toBeVisible()

    await page.getByLabel('Objet').fill('Candidature chez {{company_name|votre équipe}}')
    await page.locator('.ql-editor').fill('Bonjour {{contact_name|Madame, Monsieur}},')
    // Exact: the cadence form below has "Enregistrer le rythme".
    await page.getByRole('button', { name: 'Enregistrer', exact: true }).click()
    await expect(page.getByText('À jour')).toBeVisible()
  })

  await test.step('imports a CSV file, the invalid row set aside', async () => {
    // Within its section: the attachment panel has a file input too.
    const importSection = page.getByRole('region', { name: 'Importer des contacts' })
    await importSection.locator('input[type="file"]').setInputFiles({
      name: 'contacts.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(CSV),
    })
    await page.getByRole('button', { name: 'Importer 3 lignes' }).click()

    await expect(page.getByText('bob@example.test').first()).toBeVisible()
  })

  await test.step('launches it', async () => {
    await page.getByRole('button', { name: 'Lancer la campagne…' }).click()
    await page.getByRole('checkbox', { name: /J’ai relu l’aperçu/ }).check()
    await page.getByRole('button', { name: 'Lancer la campagne', exact: true }).click()
  })

  await test.step('follows the sending until both messages are out', async () => {
    // The page polls every ten seconds while the campaign is sending.
    await expect(page.getByText(/2 envoyés/)).toBeVisible({ timeout: 45_000 })
  })

  await test.step('Gmail received exactly one message per valid contact', async () => {
    const sent = (await (await request.get(`${API_URL}/e2e/sent`)).json()) as {
      recipients: string[]
    }

    expect(sent.recipients.sort()).toEqual(['ana@example.test', 'bob@example.test'])
  })
})
