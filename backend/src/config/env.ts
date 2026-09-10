/**
 * Typed access to the environment, read once at startup.
 *
 * The process refuses to boot when a required variable is missing, so a
 * misconfigured deployment fails immediately and loudly instead of failing
 * later on the first request that needs the value.
 *
 * Variables are added here as the phases that need them land: the database
 * and Redis URLs, the Google OAuth credentials, the session secret and the
 * encryption key. See backend/.env.example.
 */

type NodeEnv = 'development' | 'test' | 'production'

const NODE_ENVS: readonly NodeEnv[] = ['development', 'test', 'production']

function required(name: string): string {
  // The name is a literal from this module, never a value from a request.
  // eslint-disable-next-line security/detect-object-injection
  const value = process.env[name]

  if (value === undefined || value === '') {
    throw new Error(`Missing required environment variable: ${name}`)
  }

  return value
}

function optionalPort(name: string, fallback: number): number {
  // Same as above: the name is a literal from this module.
  // eslint-disable-next-line security/detect-object-injection
  const raw = process.env[name]

  if (raw === undefined || raw === '') {
    return fallback
  }

  const parsed = Number(raw)

  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    throw new Error(`${name} must be an integer between 1 and 65535, got: ${raw}`)
  }

  return parsed
}

function nodeEnv(): NodeEnv {
  const raw = process.env.NODE_ENV ?? 'development'

  if (!NODE_ENVS.includes(raw as NodeEnv)) {
    throw new Error(`NODE_ENV must be one of ${NODE_ENVS.join(', ')}, got: ${raw}`)
  }

  return raw as NodeEnv
}

export const env = {
  nodeEnv: nodeEnv(),
  port: optionalPort('PORT', 3000),
} as const

export const isProduction = env.nodeEnv === 'production'

export { required }
