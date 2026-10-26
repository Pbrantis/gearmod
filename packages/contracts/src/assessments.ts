import { z } from 'zod'

/**
 * Complexity Engine, decisões e eventos do card (docs/09). Avaliações nunca são sobrescritas: cada uma é uma versão nova,
 * com notas, pesos, justificativas e evidências. Os limites e pesos são heurísticas iniciais, configuráveis por projeto.
 */
export const complexityDimensions = ['escopo', 'acoplamento', 'incerteza', 'risco', 'novidade', 'validacao'] as const
export const complexityDimensionSchema = z.enum(complexityDimensions)
export const dimensionLabels: Record<ComplexityDimension, string> = { escopo: 'Escopo', acoplamento: 'Acoplamento', incerteza: 'Incerteza', risco: 'Risco', novidade: 'Novidade técnica', validacao: 'Dificuldade de validação' }
export const defaultComplexityWeights: Record<ComplexityDimension, number> = { escopo: 2, acoplamento: 2, incerteza: 2, risco: 3, novidade: 1, validacao: 1 }
/** 0–7 simples, 8–16 média, 17+ complexa (com os pesos padrão o máximo é 33). */
export const defaultComplexityLimits = { simpleMax: 7, mediumMax: 16 }

const score = z.number().int().min(0).max(3)
const weight = z.number().int().min(0).max(5)
export const dimensionScoresSchema = z.object({ escopo: score, acoplamento: score, incerteza: score, risco: score, novidade: score, validacao: score }).strict()
export const dimensionWeightsSchema = z.object({ escopo: weight, acoplamento: weight, incerteza: weight, risco: weight, novidade: weight, validacao: weight }).strict()
export const complexityLevelSchema = z.enum(['simple', 'medium', 'complex'])
export const confidenceSchema = z.enum(['low', 'medium', 'high'])
/** Fluxo do card: `light` = tarefa pequena (implementar e validar); `spec` = Especificação, Plano e Tasks do AgentBoard; `sdd` = método configurado do projeto. */
export const workflowKindSchema = z.enum(['light', 'spec', 'sdd'])
/** Método usado no fluxo `sdd`. `native` = o SDD completo do AgentBoard; os demais leem a pasta central configurada. */
export const sddMethodSchema = z.enum(['native', 'speckit', 'openspec', 'custom'])
/** Por que a avaliação foi (re)feita. Reavaliar só nestes gatilhos, nunca a cada mensagem. */
export const assessmentTriggerSchema = z.enum(['initial', 'requirements-changed', 'new-dependency', 'risk', 'architecture', 'scope', 'failures', 'user-correction'])
export const evidenceKindSchema = z.enum(['file', 'commit', 'diff', 'message', 'investigation', 'test', 'api', 'artifact'])
/** Referência reproduzível: caminho (com linha) ou hash, e o commit do repositório no momento da avaliação. */
export const evidenceSchema = z.object({ kind: evidenceKindSchema, ref: z.string().trim().min(1).max(1000), detail: z.string().max(2000).default(''), line: z.number().int().positive().nullable().default(null), commit: z.string().max(64).nullable().default(null) })
const isoDate = z.string().datetime()
const uuid = z.string().uuid()
export const assessmentSchema = z.object({
  id: uuid, cardId: uuid, version: z.number().int().positive(), preliminary: z.boolean(), scores: dimensionScoresSchema, weights: dimensionWeightsSchema,
  total: z.number().int().nonnegative(), level: complexityLevelSchema, confidence: confidenceSchema, criticalRisks: z.array(z.string()), justifications: z.record(z.string(), z.string()),
  evidence: z.array(evidenceSchema), workflow: workflowKindSchema, trigger: assessmentTriggerSchema, reason: z.string(), actor: z.enum(['agent', 'user']),
  profileId: uuid.nullable(), provider: z.string().nullable(), model: z.string().nullable(), effort: z.string().nullable(), codeVersion: z.string().nullable(), supersedesId: uuid.nullable(), createdAt: isoDate
})
export const decisionKindSchema = z.enum(['requirement', 'scope', 'assumption', 'technical', 'workflow', 'other'])
/** `proposed` = recomendação do agente; `approved` = decidido pelo usuário; `superseded` = trocada por outra decisão. */
export const decisionSchema = z.object({ id: uuid, cardId: uuid, number: z.number().int().positive(), kind: decisionKindSchema, statement: z.string(), rationale: z.string(), status: z.enum(['proposed', 'approved', 'superseded']), actor: z.enum(['agent', 'user']), supersedesId: uuid.nullable(), createdAt: isoDate })
/** Entendimento da demanda (skill agentboard-discovery): o que o planejamento precisa saber, sem documentação extensa. */
export const discoveryBriefSchema = z.object({
  objetivo: z.string().max(4000), motivacao: z.string().max(4000).default(''), escopo: z.array(z.string().max(1000)).max(50).default([]), exclusoes: z.array(z.string().max(1000)).max(50).default([]),
  criterios: z.array(z.string().max(1000)).max(50).default([]), pendencias: z.array(z.string().max(1000)).max(50).default([]), contextoTecnico: z.string().max(8000).default(''), prontidao: z.enum(['pronto', 'precisa-esclarecer']), registradoEm: isoDate.optional()
})
/** Exploração do código guardada em cache: vale enquanto a versão (HEAD) dos repositórios não mudar. */
export const explorationSchema = z.object({ summary: z.string(), modules: z.array(z.string()), repositories: z.array(z.string()), evidence: z.array(evidenceSchema), codeVersions: z.record(z.string(), z.string()), stale: z.boolean(), createdAt: isoDate })
export const cardComplexitySchema = z.object({ total: z.number().int(), level: complexityLevelSchema, confidence: confidenceSchema, preliminary: z.boolean(), recommended: workflowKindSchema, workflow: workflowKindSchema.nullable(), delta: z.number().int().nullable(), version: z.number().int(), createdAt: isoDate })
export const historyEventTypes = ['assessment.created', 'assessment.revised', 'assessment.contested', 'evidence.recorded', 'user.decision', 'agent.decision', 'decision.superseded', 'workflow.selected', 'discovery.recorded', 'exploration.recorded', 'artifact.updated', 'execution.started', 'execution.completed', 'handoff.completed', 'verification.completed', 'harness.alert'] as const
export const historyEventSchema = z.object({ id: uuid, v: z.literal(1), type: z.enum(historyEventTypes), at: isoDate, cardId: uuid, projectId: uuid, source: z.object({ actor: z.enum(['agent', 'user', 'system']), profileId: z.string().nullable().optional(), runId: z.string().nullable().optional(), chatId: z.string().nullable().optional() }), refs: z.array(z.string()), payload: z.record(z.string(), z.unknown()) })
/**
 * Limites da execução (Harness). Nulo = sem limite. `maxAttempts`: falhas seguidas com o mesmo erro antes de parar as retomadas
 * automáticas; `scopeCheck`: avisar quando o agente altera arquivos fora das áreas citadas no Plano.
 */
export const harnessConfigSchema = z.object({ timeoutMinutes: z.number().int().min(1).max(24 * 60).nullable(), maxTokens: z.number().int().min(1000).nullable(), maxCostUsd: z.number().min(0.01).nullable(), maxAttempts: z.number().int().min(1).max(20), scopeCheck: z.boolean() }).strict()
export const defaultHarnessConfig: HarnessConfig = { timeoutMinutes: null, maxTokens: null, maxCostUsd: null, maxAttempts: 3, scopeCheck: true }
export type HarnessConfig = z.output<typeof harnessConfigSchema>
export const workflowConfigSchema = z.object({
  weights: dimensionWeightsSchema, limits: z.object({ simpleMax: z.number().int().min(0).max(100), mediumMax: z.number().int().min(0).max(100) }).strict().refine((value) => value.simpleMax < value.mediumMax, 'O limite de simples precisa ser menor que o de média'),
  complexMethod: sddMethodSchema, sddPath: z.string().trim().max(2048).nullable(), artifactsDir: z.string().trim().max(2048).nullable(), customManifest: z.string().trim().max(2048).nullable(),
  harness: harnessConfigSchema, playwrightCli: z.boolean()
}).strict()
export const defaultWorkflowConfig: WorkflowConfig = { weights: defaultComplexityWeights, limits: defaultComplexityLimits, complexMethod: 'native', sddPath: null, artifactsDir: null, customManifest: null, harness: defaultHarnessConfig, playwrightCli: false }
export const sddDetectionSchema = z.object({ method: z.enum(['speckit', 'openspec']), path: z.string(), repository: z.string().nullable(), commands: z.array(z.string()) })
export const cardHistorySchema = z.object({ assessments: z.array(assessmentSchema), decisions: z.array(decisionSchema), discovery: discoveryBriefSchema.nullable(), exploration: explorationSchema.nullable(), workflow: workflowKindSchema.nullable(), artifactsDir: z.string(), events: z.array(historyEventSchema) })
export const contestAssessmentInputSchema = z.object({ cardId: uuid, scores: dimensionScoresSchema, reason: z.string().trim().min(1).max(4000) }).strict()

export type ComplexityDimension = (typeof complexityDimensions)[number]
export type DimensionScores = z.output<typeof dimensionScoresSchema>
export type DimensionWeights = z.output<typeof dimensionWeightsSchema>
export type ComplexityLevel = z.output<typeof complexityLevelSchema>
export type Confidence = z.output<typeof confidenceSchema>
export type WorkflowKind = z.output<typeof workflowKindSchema>
export type SddMethod = z.output<typeof sddMethodSchema>
export type AssessmentTrigger = z.output<typeof assessmentTriggerSchema>
export type Evidence = z.output<typeof evidenceSchema>
export type Assessment = z.output<typeof assessmentSchema>
export type Decision = z.output<typeof decisionSchema>
export type DecisionKind = z.output<typeof decisionKindSchema>
export type DiscoveryBrief = z.output<typeof discoveryBriefSchema>
export type Exploration = z.output<typeof explorationSchema>
export type CardComplexity = z.output<typeof cardComplexitySchema>
export type HistoryEvent = z.output<typeof historyEventSchema>
export type HistoryEventType = (typeof historyEventTypes)[number]
export type WorkflowConfig = z.output<typeof workflowConfigSchema>
export type SddDetection = z.output<typeof sddDetectionSchema>
export type CardHistory = z.output<typeof cardHistorySchema>

export function weightedTotal(scores: DimensionScores, weights: DimensionWeights): number {
  return complexityDimensions.reduce((sum, dimension) => sum + scores[dimension] * weights[dimension], 0)
}

export function complexityLevel(total: number, limits: { simpleMax: number; mediumMax: number }): ComplexityLevel {
  return total <= limits.simpleMax ? 'simple' : total <= limits.mediumMax ? 'medium' : 'complex'
}

/** Fluxo recomendado pelo nível. Regra de segurança: risco máximo nunca fica no fluxo leve, qualquer que seja a pontuação. */
export function recommendedWorkflow(level: ComplexityLevel, scores: DimensionScores): WorkflowKind {
  const base: WorkflowKind = level === 'simple' ? 'light' : level === 'medium' ? 'spec' : 'sdd'
  return base === 'light' && scores.risco >= 3 ? 'spec' : base
}

export const levelLabels: Record<ComplexityLevel, string> = { simple: 'simples', medium: 'média', complex: 'complexa' }
export const workflowLabels: Record<WorkflowKind, string> = { light: 'Fluxo curto (implementar e validar)', spec: 'Spec leve (Especificação, Plano e Tasks)', sdd: 'SDD completo (método do projeto)' }
export const triggerLabels: Record<AssessmentTrigger, string> = { initial: 'Avaliação inicial', 'requirements-changed': 'Requisitos mudaram', 'new-dependency': 'Dependência nova', risk: 'Risco novo', architecture: 'Mudança arquitetural', scope: 'Escopo corrigido', failures: 'Falhas recorrentes', 'user-correction': 'Correção do usuário' }
