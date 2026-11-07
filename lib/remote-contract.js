/**
 * Typert remote contract for the composer "拍板" button.
 *
 * The Client half mounts this contract with ctx.remote.$mount(); the Host half
 * registers it with ctx.typert.register(). Keep this file dependency-free: the
 * registry only needs a codec whose create() returns a schema with parse().
 */

function scalar(validate) {
  return {
    parse(value) {
      validate(value)
      return value
    },
    safeParse(value) {
      try {
        validate(value)
        return { success: true, data: value }
      } catch (error) {
        return { success: false, error }
      }
    },
  }
}

const sessionIdSchema = scalar((value) => {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error('sessionId must be a non-empty string')
  }
})

const booleanSchema = scalar((value) => {
  if (typeof value !== 'boolean') throw new Error('on must be a boolean')
})

const modeResultSchema = scalar((value) => {
  if (!value || typeof value.on !== 'boolean') {
    throw new Error('result must be { on: boolean }')
  }
})

function strictCodec(typeSymbol, schema) {
  return { mode: 'strict', typeSymbol, create: () => schema }
}

function parameter(name, schema) {
  return { name, wire: name, source: 'json', codec: strictCodec(name, schema) }
}

const methods = [
  ['status', [parameter('sessionId', sessionIdSchema)], modeResultSchema],
  ['setMode', [parameter('sessionId', sessionIdSchema), parameter('on', booleanSchema)], modeResultSchema],
]

export const DESCRIPTORS = methods.map(([method, parameters, result]) => ({
  id: `dsh-novel-beat#beatMode/${method}`,
  namespace: 'beatMode',
  service: 'beatMode',
  method,
  invocation: { kind: 'direct' },
  parameters,
  result: strictCodec('BeatMode', result),
}))

export const TYPERT_REMOTE = { package: 'dsh-novel-beat', descriptors: DESCRIPTORS }
