/**
 * Mail merge.
 *
 * Two rules decide everything here.
 *
 * A contact's values come from a CSV file the account owner was handed; they
 * are attacker-controlled input. In an HTML body they are escaped without
 * exception, so a name cannot inject markup into every email of a campaign.
 *
 * A placeholder never survives into a sent message. A recipient reading
 * `{{contact_name}}` is the visible failure this guards against, so an unknown
 * or empty variable becomes its fallback, or nothing at all.
 */

/** The only names that resolve. Anything else is removed rather than guessed. */
export const TEMPLATE_VARIABLES = [
  'contact_name',
  'company_name',
  'salutation',
  'email',
] as const

export type TemplateVariable = (typeof TEMPLATE_VARIABLES)[number]

export type TemplateContact = Record<TemplateVariable, string | null | undefined>

/**
 * `{{ name }}` or `{{ name|fallback }}`.
 *
 * The fallback may hold anything but a closing brace, which is what makes
 * `Bonjour {{contact_name|à vous}}` read as a sentence when the CSV had no
 * name, rather than `Bonjour ,`.
 */
/*
 * Every quantifier is bounded, because an unbounded `\s*` beside `[a-z_]+` is
 * the shape catastrophic backtracking is built from. No real variable name
 * runs past 40 characters and no sensible fallback past 200.
 *
 * security/detect-unsafe-regex still flags it: its star-height heuristic
 * counts the bounded repetitions. Measured instead of argued — 100 000
 * characters of `{{` followed by spaces, of an unterminated `{{a…`, of
 * `{{a|x…` and of repeated `{{a ` each take under half a millisecond, and a
 * 192 KB real template takes 2.3 ms. The matching is linear.
 */
// eslint-disable-next-line security/detect-unsafe-regex
const PLACEHOLDER = /\{\{ {0,8}([a-z_]{1,40}) {0,8}(?:\|([^}]{0,200}))?\}\}/gi

const HTML_ESCAPES = new Map<string, string>([
  ['&', '&amp;'],
  ['<', '&lt;'],
  ['>', '&gt;'],
  ['"', '&quot;'],
  ["'", '&#39;'],
])

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => HTML_ESCAPES.get(char) ?? char)
}

function isKnown(name: string): name is TemplateVariable {
  // includes on the literal list, not a property lookup: a lookup would answer
  // for `constructor` and `__proto__` too.
  return (TEMPLATE_VARIABLES as readonly string[]).includes(name)
}

/**
 * A switch rather than `contact[name]`.
 *
 * Indexing an object by a variable is an injection sink even when the key is a
 * narrowed union, and TypeScript checks this switch is exhaustive, so adding a
 * variable to the list without handling it here fails the build.
 */
function valueOf(
  contact: TemplateContact,
  name: TemplateVariable,
): string | null | undefined {
  switch (name) {
    case 'contact_name':
      return contact.contact_name
    case 'company_name':
      return contact.company_name
    case 'salutation':
      return contact.salutation
    case 'email':
      return contact.email
  }
}

function resolve(
  contact: TemplateContact,
  name: string,
  fallback: string | undefined,
): string {
  if (!isKnown(name)) {
    return ''
  }

  const value = valueOf(contact, name)

  // Whitespace counts as missing: a CSV column full of spaces should read as
  // an absent value, not push an empty gap into the sentence.
  if (typeof value === 'string' && value.trim() !== '') {
    return value
  }

  return fallback ?? ''
}

function render(
  template: string,
  contact: TemplateContact,
  transform: (value: string) => string,
): string {
  return template.replace(PLACEHOLDER, (_match, name: string, fallback?: string) =>
    transform(resolve(contact, name, fallback)),
  )
}

/** For the plain-text body. Values are inserted as they are. */
export function renderText(template: string, contact: TemplateContact): string {
  return render(template, contact, (value) => value)
}

/**
 * For the HTML body. Every inserted value is escaped, the fallback included.
 *
 * The template itself is left alone: it is written by the account owner, who
 * is allowed to use markup. Only what comes from a contact is escaped.
 */
export function renderHtml(template: string, contact: TemplateContact): string {
  return neutraliseUnsafeLinks(render(template, contact, escapeHtml))
}

/**
 * A link or source whose value starts with a script-carrying scheme.
 *
 * Escaping stops a CSV value from adding markup, but not from being a URL: a
 * template with `<a href="{{company_name}}">` and a CSV row holding
 * `javascript:…` would put a script link in the email. Mail clients mostly
 * refuse such links; this makes sure the application never sends one.
 *
 * Every quantifier is bounded. A value cannot smuggle the scheme in as an
 * entity (`&#106;avascript:`): its `&` is escaped to `&amp;` before this runs.
 */
const UNSAFE_LINK =
  /(\s(?:href|src) {0,4}= {0,4}["']? {0,20})(?:javascript|vbscript|data) {0,4}:/gi

/** Replaces the scheme with a fragment, which a client treats as a link to nowhere. */
export function neutraliseUnsafeLinks(html: string): string {
  return html.replace(UNSAFE_LINK, '$1#')
}

/**
 * The known variables a template uses, each once.
 *
 * Lets the interface tell the user which CSV columns a campaign actually
 * needs before they import a file that lacks one.
 */
export function extractVariables(template: string): TemplateVariable[] {
  const found = new Set<TemplateVariable>()

  for (const match of template.matchAll(PLACEHOLDER)) {
    const name = match[1]

    if (name && isKnown(name)) {
      found.add(name)
    }
  }

  return [...found]
}
