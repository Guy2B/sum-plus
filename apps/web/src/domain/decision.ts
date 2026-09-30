/**
 * Σ decision engine — deterministic, explainable ranking of signals.
 *
 * Pipeline per signal: knowledge → facts → policy rules → behaviour
 * personalisation → score → edition weighting → explanation. The arbitrator
 * then picks at most `maxItems` decisions under a time budget, favouring
 * cross-source corroboration and source diversity.
 *
 * Ported from the V7.2 browser engine; all user-facing wording is emitted as
 * i18n keys so explanations are localised and never fabricated.
 */
import type { Contact, DecisionFeedback, EditionKey, RelationshipType } from './types';
import type { Signal, SourceType } from './signals';
import { signalText } from './signals';
import { EDITION_PROFILES, inferTags } from './editions';
import { ageHours, hoursUntil, toDate } from './dates';
import { clamp, includesAny, normalizeText, round, similarity, weightedAverage } from './text';

export type Intent =
  | 'promotion'
  | 'transactional'
  | 'opportunity'
  | 'request'
  | 'prepare'
  | 'execute'
  | 'capacity'
  | 'information';
export type Action = 'reply' | 'execute' | 'prepare' | 'review' | 'ignore' | 'recover';
export type Band = 'critical' | 'high' | 'medium' | 'low';

export interface Reason {
  key: string;
  params?: Record<string, string | number>;
}

export interface DecisionContext {
  primaryGoal?: string;
  goals?: string[];
  contacts?: Pick<Contact, 'name' | 'email' | 'relationshipType'>[];
  edition: EditionKey;
  feedback?: Pick<
    DecisionFeedback,
    'action' | 'sourceType' | 'intent' | 'category' | 'relationshipType' | 'hour'
  >[];
}

export interface Facts {
  intent: Intent;
  relationshipType: RelationshipType;
  relationshipValue: number;
  sourceTrust: number;
  goalAlignment: number;
  commercialValue: number;
  isPromotion: boolean;
  isAutomated: boolean;
  hoursToDue: number | null;
  waitingHours: number;
  importance: number;
  urgency: number;
  impact: number;
  costOfInaction: number;
  confidence: number;
  effortMinutes: number;
  reversibility: number;
}

export interface Decision {
  signal: Signal;
  facts: Facts;
  score: number;
  band: Band;
  action: Action;
  requiresReview: boolean;
  tags: string[];
  reasons: Reason[];
  uncertainties: Reason[];
  firedRules: string[];
  formula: { base: number; rules: number; behavior: number; edition: number; confidencePenalty: number };
  corroboratedBy?: string[];
}

/* ------------------------------ knowledge -------------------------------- */

const PROMOTION_TERMS = [
  'reward',
  'discount',
  'promotion',
  'promo',
  'newsletter',
  'unsubscribe',
  'special offer',
  'limited offer',
  'remise',
  'recompense',
  'desabonner',
  'offre speciale',
  'soldes',
  'rabatt',
  'abmelden',
  'descuento',
  'darse de baja',
];
const TRANSACTIONAL_TERMS = [
  'invoice',
  'facture',
  'payment',
  'paiement',
  'contract',
  'contrat',
  'renewal',
  'renouvellement',
  'deadline',
  'echeance',
  'overdue',
  'en retard',
  'rechnung',
  'zahlung',
  'vertrag',
  'factura',
  'pago',
  'contrato',
];
const OPPORTUNITY_TERMS = [
  'proposal',
  'proposition',
  'quote',
  'devis',
  'pricing',
  'tarif',
  'budget',
  'client',
  'prospect',
  'partnership',
  'partenariat',
  'interview',
  'entretien',
  'opportunity',
  'opportunite',
  'angebot',
  'kunde',
  'propuesta',
  'presupuesto',
  'entrevista',
];
const REQUEST_TERMS = [
  'please',
  'could you',
  'can you',
  'need you',
  'action required',
  'reply',
  'repondre',
  'pouvez-vous',
  'merci de',
  'besoin de',
  'a valider',
  'approval',
  'approve',
  'confirm',
  'confirmer',
  'bitte',
  'por favor',
  'puede',
];

export const RELATIONSHIP_WEIGHTS: Record<RelationshipType, number> = {
  strategic_client: 1.0,
  client: 0.88,
  active_prospect: 0.82,
  partner: 0.76,
  manager: 0.74,
  colleague: 0.58,
  candidate: 0.56,
  community: 0.42,
  unknown: 0.34,
  vendor: 0.32,
  automated: 0.1,
  marketing: 0.06,
};

export function inferIntent(signal: Signal): Intent {
  if (signal.sourceType === 'health') return 'capacity';
  const text = signalText(signal);
  if (signal.sourceType === 'mail' || signal.sourceType === 'social') {
    if (includesAny(text, PROMOTION_TERMS)) return 'promotion';
  }
  if (signal.sourceType === 'finance' || includesAny(text, TRANSACTIONAL_TERMS)) return 'transactional';
  if (includesAny(text, OPPORTUNITY_TERMS)) return 'opportunity';
  if (signal.needsReply || includesAny(text, REQUEST_TERMS)) return 'request';
  if (signal.sourceType === 'event') return 'prepare';
  if (['task', 'project', 'habit', 'learning', 'household', 'career', 'mission'].includes(signal.sourceType))
    return 'execute';
  return 'information';
}

export function inferRelationship(signal: Signal, ctx: DecisionContext, intent: Intent): RelationshipType {
  if (signal.relationshipType) return signal.relationshipType;
  const sender = normalizeText(`${signal.sender ?? ''} ${signal.senderEmail ?? ''}`);
  if (sender) {
    const match = (ctx.contacts ?? []).find((c) => {
      const email = normalizeText(c.email ?? '');
      const name = normalizeText(c.name ?? '');
      return (email && sender.includes(email)) || (name.length > 2 && sender.includes(name));
    });
    if (match) return match.relationshipType;
    if (/no-?reply|noreply|mailer|notification|donotreply/.test(sender)) {
      return intent === 'promotion' ? 'marketing' : 'automated';
    }
  }
  return 'unknown';
}

function sourceTrust(signal: Signal): number {
  if (signal.userCreated) return 0.96;
  switch (signal.sourceType) {
    case 'task':
      return 0.9;
    case 'event':
      return 0.92;
    case 'mail':
      return signal.sender ? 0.84 : 0.68;
    case 'social':
      return 0.64;
    case 'health':
      return 0.8;
    default:
      return 0.75;
  }
}

function goalAlignment(signal: Signal, ctx: DecisionContext): number {
  const goals = [ctx.primaryGoal, ...(ctx.goals ?? [])].filter((g): g is string => Boolean(g && g.trim()));
  if (!goals.length) return 0.35;
  const text = signalText(signal);
  return clamp(Math.max(...goals.map((g) => similarity(text, g))) * 2.2, 0, 1);
}

function commercialValue(signal: Signal, intent: Intent): number {
  const amount = Number(signal.amount ?? 0);
  if (amount > 0) return clamp(Math.log10(amount + 1) / 5, 0.2, 1);
  return intent === 'opportunity' ? 0.55 : 0;
}

export function estimateEffort(signal: Signal): number {
  const explicit = Number(signal.estimateMinutes ?? 0);
  if (explicit > 0) return clamp(explicit, 1, 480);
  if (signal.sourceType === 'mail' || signal.sourceType === 'social') return signal.needsReply ? 8 : 3;
  if (signal.sourceType === 'event') return 20;
  if (signal.sourceType === 'task') return 30;
  return 15;
}

/* -------------------------------- facts ---------------------------------- */

export function buildFacts(signal: Signal, ctx: DecisionContext, now: Date): Facts {
  const intent = inferIntent(signal);
  const relationshipType = inferRelationship(signal, ctx, intent);
  const relationshipValue = RELATIONSHIP_WEIGHTS[relationshipType];
  const trust = sourceTrust(signal);
  const alignment = goalAlignment(signal, ctx);
  const commercial = commercialValue(signal, intent);
  const isPromotion = intent === 'promotion';
  const isAutomated = relationshipType === 'automated' || relationshipType === 'marketing';
  const hoursToDue = hoursUntil(signal.dueAt, now);
  const age = ageHours(signal.receivedAt ?? signal.createdAt, now);
  const waitingHours = signal.needsReply ? age : 0;

  const importance = clamp(
    25 +
      relationshipValue * 35 +
      alignment * 24 +
      commercial * 16 +
      (signal.important || signal.essential ? 18 : 0) -
      (isPromotion ? 55 : 0) -
      (isAutomated ? 12 : 0),
  );

  let urgency = 12;
  if (hoursToDue !== null) {
    if (hoursToDue < 0) urgency = 96;
    else if (hoursToDue <= 6) urgency = 90;
    else if (hoursToDue <= 24) urgency = 78;
    else if (hoursToDue <= 48) urgency = 62;
    else if (hoursToDue <= 168) urgency = 40;
  }
  if (signal.urgent) urgency = Math.max(urgency, 82);
  if (signal.essential) urgency = Math.max(urgency, 75);
  if (signal.needsReply && waitingHours >= 48) urgency += 18;
  else if (signal.needsReply && waitingHours >= 24) urgency += 10;
  if (isPromotion) urgency = Math.min(urgency, 8);

  const impact = clamp(
    18 +
      alignment * 32 +
      relationshipValue * 22 +
      commercial * 28 +
      (signal.riskLevel === 'high' ? 22 : signal.riskLevel === 'medium' ? 10 : 0) +
      (signal.essential ? 15 : 0) -
      (isPromotion ? 45 : 0),
  );

  const costOfInaction = clamp(
    urgency * 0.38 + impact * 0.42 + relationshipValue * 20 + (signal.needsReply ? 10 : 0),
  );

  const completeness =
    [
      Boolean(signal.title || signal.titleKey),
      Boolean(signal.sender || signal.userCreated || signal.sourceType !== 'mail'),
      Boolean(signal.receivedAt || signal.createdAt || signal.dueAt),
      Boolean(signal.category || intent !== 'information'),
    ].filter(Boolean).length / 4;

  const confidence = clamp((trust * 0.55 + completeness * 0.45) * 100);

  return {
    intent,
    relationshipType,
    relationshipValue,
    sourceTrust: trust,
    goalAlignment: alignment,
    commercialValue: commercial,
    isPromotion,
    isAutomated,
    hoursToDue,
    waitingHours,
    importance: round(importance),
    urgency: round(clamp(urgency)),
    impact: round(impact),
    costOfInaction: round(costOfInaction),
    confidence: round(confidence),
    effortMinutes: estimateEffort(signal),
    reversibility: 82,
  };
}

/* -------------------------------- rules ---------------------------------- */

interface Rule {
  id: string;
  priority: number;
  when: (f: Facts, s: Signal) => boolean;
  score?: number;
  action?: Action | ((f: Facts, s: Signal) => Action);
  band?: Band;
  requiresReview?: boolean;
}

export const RULES: Rule[] = [
  {
    id: 'irreversible',
    priority: 99,
    when: (f) => f.reversibility < 40,
    action: 'review',
    requiresReview: true,
  },
  { id: 'promotion', priority: 100, when: (f) => f.isPromotion, score: -75, action: 'ignore', band: 'low' },
  {
    id: 'lowConfidence',
    priority: 95,
    when: (f) => f.confidence < 60,
    score: -20,
    action: 'review',
    requiresReview: true,
  },
  { id: 'automated', priority: 90, when: (f) => f.isAutomated && f.intent !== 'transactional', score: -25 },
  {
    id: 'strategicReply',
    priority: 85,
    when: (f, s) => Boolean(s.needsReply) && f.relationshipValue >= 0.75 && f.waitingHours >= 24,
    score: 22,
    action: 'reply',
  },
  {
    id: 'overdue',
    priority: 84,
    when: (f) => f.hoursToDue !== null && f.hoursToDue < 0,
    score: 28,
    action: (_f, s) => (s.sourceType === 'mail' ? 'reply' : 'execute'),
  },
  {
    id: 'dueToday',
    priority: 82,
    when: (f) => f.hoursToDue !== null && f.hoursToDue >= 0 && f.hoursToDue <= 24,
    score: 20,
    action: (_f, s) => (s.sourceType === 'event' ? 'prepare' : 'execute'),
  },
  {
    id: 'prepareMeeting',
    priority: 78,
    when: (f, s) =>
      s.sourceType === 'event' && f.hoursToDue !== null && f.hoursToDue >= 0 && f.hoursToDue <= 24,
    score: 18,
    action: 'prepare',
  },
  {
    id: 'opportunity',
    priority: 76,
    when: (f) => f.intent === 'opportunity' && (f.commercialValue >= 0.5 || f.relationshipValue >= 0.75),
    score: 18,
    action: (_f, s) => (s.needsReply ? 'reply' : 'review'),
  },
  { id: 'capacity', priority: 70, when: (f) => f.intent === 'capacity', score: 12, action: 'recover' },
  { id: 'essential', priority: 65, when: (_f, s) => Boolean(s.essential), score: 14, action: 'execute' },
  {
    id: 'quickWin',
    priority: 60,
    when: (f) => f.effortMinutes <= 10 && f.impact >= 60 && f.confidence >= 65,
    score: 10,
  },
];

function defaultAction(signal: Signal): Action {
  switch (signal.sourceType) {
    case 'mail':
    case 'social':
      return signal.needsReply ? 'reply' : 'review';
    case 'event':
      return 'prepare';
    case 'health':
      return 'recover';
    default:
      return 'execute';
  }
}

export function evaluateRules(facts: Facts, signal: Signal) {
  const fired = RULES.filter((r) => {
    try {
      return r.when(facts, signal);
    } catch {
      return false;
    }
  }).sort((a, b) => b.priority - a.priority);
  let adjustment = 0;
  let action: Action | null = null;
  let band: Band | null = null;
  let requiresReview = false;
  for (const r of fired) {
    adjustment += r.score ?? 0;
    const a = typeof r.action === 'function' ? r.action(facts, signal) : r.action;
    if (!action && a) action = a;
    if (!band && r.band) band = r.band;
    requiresReview ||= Boolean(r.requiresReview);
  }
  return {
    adjustment: clamp(adjustment, -85, 65),
    action,
    band,
    requiresReview,
    fired: fired.map((r) => r.id),
  };
}

/* ------------------------------ behaviour -------------------------------- */

export const MIN_OBSERVATIONS = 5;

export interface BehaviorProfile {
  ready: boolean;
  observations: number;
  confidence: number;
  preferredHour: number | null;
  patterns: {
    dimension: string;
    value: string;
    total: number;
    acceptance: number;
    rejection: number;
    confidence: number;
  }[];
  /** "Not at this time of day" rules learned from wrong-time / deferred / rejected feedback. */
  timeRules: TimeRule[];
}

export type DayPeriod = 'morning' | 'afternoon' | 'evening';
export const periodOf = (hour: number): DayPeriod =>
  hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening';

export interface TimeRule {
  dimension: 'category' | 'sourceType';
  value: string;
  period: DayPeriod;
  total: number;
  avoidRate: number;
}

/** Minimum feedback on one (category, period) pair before Σ changes its behaviour. */
export const MIN_TIME_OBSERVATIONS = 3;

export function learnTimeRules(feedback: DecisionContext['feedback'] = []): TimeRule[] {
  const groups = new Map<
    string,
    { rule: Omit<TimeRule, 'total' | 'avoidRate'>; total: number; avoid: number }
  >();
  for (const r of feedback ?? []) {
    const period = periodOf(r.hour);
    for (const dimension of ['category', 'sourceType'] as const) {
      const value = r[dimension];
      if (!value) continue;
      const key = `${dimension}|${value}|${period}`;
      const g = groups.get(key) ?? { rule: { dimension, value, period }, total: 0, avoid: 0 };
      g.total += 1;
      if (r.action === 'wrongTime' || r.action === 'deferred' || r.action === 'rejected') g.avoid += 1;
      groups.set(key, g);
    }
  }
  return (
    [...groups.values()]
      .filter((g) => g.total >= MIN_TIME_OBSERVATIONS && g.avoid / g.total >= 0.6)
      .map((g) => ({ ...g.rule, total: g.total, avoidRate: g.avoid / g.total }))
      // A category rule is more specific than the source rule it overlaps.
      .sort((a, b) => b.avoidRate - a.avoidRate || b.total - a.total)
  );
}

export function learnProfile(feedback: DecisionContext['feedback'] = []): BehaviorProfile {
  const rows = feedback ?? [];
  const timeRules = learnTimeRules(rows);
  if (rows.length < MIN_OBSERVATIONS) {
    return {
      ready: false,
      observations: rows.length,
      confidence: rows.length / MIN_OBSERVATIONS,
      preferredHour: null,
      patterns: [],
      timeRules,
    };
  }
  const hours = new Map<number, number>();
  rows
    .filter((r) => r.action === 'accepted' || r.action === 'completed')
    .forEach((r) => hours.set(r.hour, (hours.get(r.hour) ?? 0) + 1));
  const preferredHour = [...hours.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const patterns: BehaviorProfile['patterns'] = [];
  for (const dimension of ['sourceType', 'intent', 'category', 'relationshipType'] as const) {
    const groups = new Map<string, { total: number; acc: number; rej: number }>();
    for (const r of rows) {
      const key = r[dimension];
      if (!key) continue;
      const g = groups.get(key) ?? { total: 0, acc: 0, rej: 0 };
      g.total += 1;
      if (r.action === 'accepted' || r.action === 'completed') g.acc += 1;
      if (r.action === 'rejected') g.rej += 1;
      groups.set(key, g);
    }
    groups.forEach((g, value) => {
      if (g.total < MIN_OBSERVATIONS) return;
      patterns.push({
        dimension,
        value,
        total: g.total,
        acceptance: g.acc / g.total,
        rejection: g.rej / g.total,
        confidence: clamp(g.total / 20, 0, 1),
      });
    });
  }
  return {
    ready: true,
    observations: rows.length,
    confidence: clamp(rows.length / 30, 0.2, 1),
    preferredHour,
    patterns,
    timeRules,
  };
}

function behaviorAdjustment(signal: Signal, facts: Facts, profile: BehaviorProfile, now: Date) {
  let adjustment = 0;
  const reasons: Reason[] = [];
  // Learned "not now" rules apply as soon as they exist (explicit user feedback).
  const period = periodOf(now.getHours());
  const rule = (profile.timeRules ?? []).find(
    (r) =>
      r.period === period && (r.dimension === 'category' ? signal.category : signal.sourceType) === r.value,
  );
  if (rule && !(facts.hoursToDue !== null && facts.hoursToDue <= 4)) {
    adjustment -= 18 * rule.avoidRate;
    reasons.push({ key: 'reason.behavior.avoidPeriod' });
  }
  if (!profile.ready) return { adjustment: clamp(adjustment, -18, 0), reasons };
  const values: Record<string, string | undefined> = {
    sourceType: signal.sourceType,
    intent: facts.intent,
    category: signal.category,
    relationshipType: facts.relationshipType,
  };
  for (const p of profile.patterns) {
    if (values[p.dimension] !== p.value) continue;
    const delta = (p.acceptance - p.rejection) * 8 * p.confidence;
    adjustment += delta;
    if (Math.abs(delta) >= 1.5)
      reasons.push({
        key: delta > 0 ? 'reason.behavior.act' : 'reason.behavior.reject',
        params: { value: p.value },
      });
  }
  if (profile.preferredHour !== null) {
    const d = Math.abs(now.getHours() - profile.preferredHour);
    if (Math.min(d, 24 - d) <= 1) {
      adjustment += 2 * profile.confidence;
      reasons.push({ key: 'reason.behavior.time' });
    }
  }
  return { adjustment: clamp(adjustment, -12, 12), reasons };
}

/* ------------------------------- scoring --------------------------------- */

function baseScore(f: Facts): number {
  const efficiency = clamp(100 - f.effortMinutes * 1.25);
  return (
    weightedAverage([
      { value: f.importance, weight: 0.27 },
      { value: f.urgency, weight: 0.25 },
      { value: f.impact, weight: 0.2 },
      { value: f.costOfInaction, weight: 0.14 },
      { value: efficiency, weight: 0.06 },
      { value: f.confidence, weight: 0.08 },
    ]) + (f.intent === 'opportunity' ? f.commercialValue * 8 : 0)
  );
}

/**
 * Maps the unbounded priority onto 0..100 with a soft saturation so that
 * strong items stay distinguishable instead of all clipping at 100.
 */
export function toScore(priority: number): number {
  return round(100 * (1 - Math.exp(-Math.max(0, priority) / 70)));
}

export function bandFor(score: number): Band {
  if (score >= 85) return 'critical';
  if (score >= 70) return 'high';
  if (score >= 50) return 'medium';
  return 'low';
}

function dimensionReasons(f: Facts): Reason[] {
  const r: Reason[] = [];
  if (f.urgency >= 70) r.push({ key: 'reason.dim.urgency', params: { value: f.urgency } });
  if (f.importance >= 70) r.push({ key: 'reason.dim.importance', params: { value: f.importance } });
  if (f.impact >= 70) r.push({ key: 'reason.dim.impact', params: { value: f.impact } });
  if (f.costOfInaction >= 70) r.push({ key: 'reason.dim.costOfInaction' });
  if (f.effortMinutes <= 10 && f.impact >= 55)
    r.push({ key: 'reason.dim.quickEffort', params: { minutes: f.effortMinutes } });
  if (f.relationshipValue >= 0.75) r.push({ key: 'reason.dim.relationship' });
  if (f.goalAlignment >= 0.55) r.push({ key: 'reason.dim.goal' });
  return r;
}

export function decide(signal: Signal, ctx: DecisionContext, profile: BehaviorProfile, now: Date): Decision {
  const facts = buildFacts(signal, ctx, now);
  const rules = evaluateRules(facts, signal);
  const behavior = behaviorAdjustment(signal, facts, profile, now);

  const raw = baseScore(facts);
  const confidencePenalty = facts.confidence < 60 ? (60 - facts.confidence) * 0.28 : 0;
  let priority = raw + rules.adjustment + behavior.adjustment - confidencePenalty;
  const action: Action = rules.action ?? defaultAction(signal);

  // Edition weighting never overrides a hard safety rule (promotion / ignore).
  const text = signalText(signal);
  const tags = inferTags(signal, text);
  let editionDelta = 0;
  const editionReasons: Reason[] = [];
  if (action !== 'ignore') {
    const p = EDITION_PROFILES[ctx.edition];
    for (const tag of tags) {
      const b = p.boosts[tag] ?? 0;
      const pen = p.penalties[tag] ?? 0;
      if (b) editionReasons.push({ key: 'reason.edition.boost', params: { tag } });
      editionDelta += b + pen;
    }
    editionDelta += p.sourceBoosts[signal.sourceType] ?? 0;
    editionDelta += p.intentBoosts[facts.intent] ?? 0;
    // Edition weighting is a nudge, not a takeover: cap its influence.
    editionDelta = clamp(editionDelta, -30, 30);
    priority += editionDelta;
  }

  // Explicit lineage: serving an active goal, or unblocking later steps, raises the priority.
  const lineageReasons: Reason[] = [];
  if (action !== 'ignore') {
    if (signal.chain?.length) {
      priority += 8;
      lineageReasons.push({ key: 'reason.chain', params: { chain: signal.chain.join(' → ') } });
    }
    if (signal.unblocks) {
      priority += Math.min(12, 4 * signal.unblocks);
      lineageReasons.push({ key: 'reason.unblocks', params: { count: signal.unblocks } });
    }
  }

  const score = toScore(priority);
  const band = rules.band ?? bandFor(score);
  const ruleReasons: Reason[] = rules.fired.map((id) => ({ key: `reason.rule.${id}` }));
  const reasons = dedupeReasons([
    ...(signal.explain ?? []),
    ...ruleReasons,
    ...lineageReasons,
    ...dimensionReasons(facts),
    ...behavior.reasons,
    ...editionReasons.slice(0, 1),
  ]).slice(0, 5);

  const uncertainties: Reason[] = [];
  if (facts.confidence < 65) uncertainties.push({ key: 'uncertainty.incomplete' });
  if (
    (signal.sourceType === 'mail' || signal.sourceType === 'social') &&
    facts.relationshipType === 'unknown'
  ) {
    uncertainties.push({ key: 'uncertainty.relationship' });
  }
  if (!signal.dueAt && facts.urgency >= 60) uncertainties.push({ key: 'uncertainty.inferredUrgency' });
  if (!profile.ready)
    uncertainties.push({
      key: 'uncertainty.personalization',
      params: { count: profile.observations, min: MIN_OBSERVATIONS },
    });

  return {
    signal,
    facts,
    score,
    band,
    action,
    requiresReview: rules.requiresReview,
    tags,
    reasons,
    uncertainties,
    firedRules: rules.fired,
    formula: {
      base: round(raw, 1),
      rules: round(rules.adjustment, 1),
      behavior: round(behavior.adjustment, 1),
      edition: round(editionDelta, 1),
      confidencePenalty: round(confidencePenalty, 1),
    },
  };
}

function dedupeReasons(list: Reason[]): Reason[] {
  const seen = new Set<string>();
  return list.filter((r) => {
    const k = r.key + JSON.stringify(r.params ?? {});
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/* ------------------------------ arbitration ------------------------------ */

export const DEFAULT_SOURCE_LIMITS: Partial<Record<SourceType, number>> = {
  mail: 1,
  social: 1,
  task: 2,
  event: 2,
  finance: 2,
  learning: 1,
  health: 1,
  project: 2,
  habit: 1,
  household: 1,
  career: 1,
  mission: 2,
};

export type RejectionReason =
  'promotion' | 'ignored' | 'low-priority' | 'merged' | 'source-limit' | 'capacity' | 'lower-score';

export interface Arbitration {
  selected: Decision[];
  rejected: { decision: Decision; reason: RejectionReason }[];
  usedMinutes: number;
  capacityMinutes: number;
}

function topic(d: Decision): string {
  return normalizeText(`${signalText(d.signal)} ${d.signal.sender ?? ''}`);
}

export function arbitrate(
  decisions: Decision[],
  opts: {
    capacityMinutes?: number;
    maxItems?: number;
    sourceLimits?: Partial<Record<SourceType, number>>;
    fillWithLow?: boolean;
  } = {},
): Arbitration {
  const capacity = opts.capacityMinutes ?? 180;
  const maxItems = opts.maxItems ?? 3;
  const limits = { ...DEFAULT_SOURCE_LIMITS, ...opts.sourceLimits };
  const rejected: Arbitration['rejected'] = [];
  const eligible: Decision[] = [];

  for (const d of decisions) {
    if (d.facts.isPromotion) rejected.push({ decision: d, reason: 'promotion' });
    else if (d.action === 'ignore') rejected.push({ decision: d, reason: 'ignored' });
    else if (d.band === 'low') rejected.push({ decision: d, reason: 'low-priority' });
    else eligible.push(d);
  }

  // Cluster near-duplicates across sources (e.g. an email and a task about the same invoice).
  const clusters: { primary: Decision; items: Decision[]; sources: Set<string> }[] = [];
  for (const d of [...eligible].sort((a, b) => b.score - a.score)) {
    const t = topic(d);
    const hit = clusters.find((c) => similarity(topic(c.primary), t) >= 0.64);
    if (hit) {
      hit.items.push(d);
      hit.sources.add(d.signal.sourceType);
    } else clusters.push({ primary: d, items: [d], sources: new Set([d.signal.sourceType]) });
  }
  const pool: Decision[] = clusters.map((c) => {
    const others = c.items.filter((i) => i !== c.primary);
    others.forEach((o) => rejected.push({ decision: o, reason: 'merged' }));
    const boost = Math.min(12, (c.sources.size - 1) * 5);
    if (!boost) return c.primary;
    return {
      ...c.primary,
      score: round(clamp(c.primary.score + boost)),
      corroboratedBy: others.map((o) => o.signal.id),
      reasons: [
        { key: 'reason.arbitration.corroborated', params: { count: c.sources.size } },
        ...c.primary.reasons,
      ].slice(0, 5),
    };
  });

  const selected: Decision[] = [];
  const counts = new Map<string, number>();
  let used = 0;
  const effective = (d: Decision) => {
    const n = counts.get(d.signal.sourceType) ?? 0;
    const sameAction = selected.filter((s) => s.action === d.action).length;
    return d.score + (n === 0 ? 4 : 0) + (d.band === 'critical' ? 8 : 0) - n * 7 - sameAction * 4;
  };
  while (pool.length && selected.length < maxItems) {
    pool.sort((a, b) => effective(b) - effective(a) || b.facts.confidence - a.facts.confidence);
    const c = pool.shift() as Decision;
    const n = counts.get(c.signal.sourceType) ?? 0;
    const limit = limits[c.signal.sourceType] ?? 1;
    if (n >= limit && c.band !== 'critical') {
      rejected.push({ decision: c, reason: 'source-limit' });
      continue;
    }
    if (used + c.facts.effortMinutes > capacity && selected.length > 0) {
      rejected.push({ decision: c, reason: 'capacity' });
      continue;
    }
    selected.push(c);
    used += c.facts.effortMinutes;
    counts.set(c.signal.sourceType, n + 1);
  }
  pool.forEach((d) => rejected.push({ decision: d, reason: 'lower-score' }));

  // With little data, surface the best remaining low-priority items rather than an empty day.
  if (opts.fillWithLow && selected.length < maxItems) {
    const lows = rejected
      .filter((r) => r.reason === 'low-priority')
      .sort((a, b) => b.decision.score - a.decision.score)
      .slice(0, maxItems - selected.length);
    for (const r of lows) {
      selected.push(r.decision);
      used += r.decision.facts.effortMinutes;
      rejected.splice(rejected.indexOf(r), 1);
    }
  }
  return { selected, rejected, usedMinutes: used, capacityMinutes: capacity };
}

/** Convenience: rank every signal (sorted, best first). */
export function rankSignals(signals: Signal[], ctx: DecisionContext, now: Date = new Date()): Decision[] {
  const profile = learnProfile(ctx.feedback);
  return signals.map((s) => decide(s, ctx, profile, now)).sort((a, b) => b.score - a.score);
}

export function isDue(value: unknown, now: Date): boolean {
  const d = toDate(value);
  return Boolean(d && d.getTime() <= now.getTime());
}
