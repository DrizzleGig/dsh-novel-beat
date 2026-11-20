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

const panelResultSchema = scalar((value) => {
  if (!value || typeof value.on !== 'boolean' || typeof value.text !== 'string') {
    throw new Error('result must be { on: boolean, text: string }')
  }
})

const actionResultSchema = scalar((value) => {
  if (!value || typeof value.ok !== 'boolean' || typeof value.text !== 'string') {
    throw new Error('result must be { ok: boolean, text: string }')
  }
})

const objectResultSchema = scalar((value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('result must be an object')
  }
})

const chapterSchema = scalar((value) => {
  if (!Number.isInteger(value) || value < 1 || value > 9999) {
    throw new Error('chapter must be an integer from 1 to 9999')
  }
})

const decisionIdSchema = scalar((value) => {
  if (typeof value !== 'string' || value.length === 0 || value.length > 64) {
    throw new Error('decisionId must be a non-empty string, at most 64 characters')
  }
})

const jsonObjectSchema = scalar((value) => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('expected a JSON object')
  }
})

const resumeTextSchema = scalar((value) => {
  if (typeof value !== 'string' || value.length === 0 || value.length > 500) {
    throw new Error('resume text must be a non-empty string, at most 500 characters')
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
  ['panel', [parameter('sessionId', sessionIdSchema)], panelResultSchema],
  ['revertLast', [parameter('sessionId', sessionIdSchema)], actionResultSchema],
  ['overview', [parameter('sessionId', sessionIdSchema)], objectResultSchema],
  ['chapter', [parameter('sessionId', sessionIdSchema), parameter('chapter', chapterSchema)], objectResultSchema],
  ['impact', [parameter('sessionId', sessionIdSchema), parameter('decisionId', decisionIdSchema), parameter('options', jsonObjectSchema)], objectResultSchema],
  ['rewind', [parameter('sessionId', sessionIdSchema), parameter('decisionId', decisionIdSchema), parameter('options', jsonObjectSchema)], objectResultSchema],
  ['resume', [parameter('sessionId', sessionIdSchema), parameter('text', resumeTextSchema)], objectResultSchema],
  ['oldLine', [parameter('sessionId', sessionIdSchema), parameter('decisionId', decisionIdSchema)], objectResultSchema],
  ['timeline', [parameter('sessionId', sessionIdSchema), parameter('options', jsonObjectSchema)], objectResultSchema],
  ['health', [parameter('sessionId', sessionIdSchema), parameter('options', jsonObjectSchema)], objectResultSchema],
  ['search', [parameter('sessionId', sessionIdSchema), parameter('options', jsonObjectSchema)], objectResultSchema],
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
