/**
 * Canonical domain model. Every persisted record is a `Doc` living in one named
 * collection; timestamps are ISO-8601 strings so records serialise losslessly to
 * IndexedDB, Firestore and JSON exports.
 */

export type ISODate = string; // YYYY-MM-DD
export type ISODateTime = string; // full ISO-8601

export interface Doc {
  id: string;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
  /** Tombstone: soft-deleted records are kept so deletions replicate across devices. */
  deletedAt?: ISODateTime | null;
}

export type EditionKey = 'student' | 'solo' | 'creator' | 'life' | 'nomad';
export type Locale = 'fr' | 'en' | 'de' | 'es';
export type Currency = 'EUR' | 'USD' | 'GBP' | 'CHF' | 'CAD';

export interface SourceRef {
  provider: string;
  ref?: string;
  url?: string;
}

export type TaskCategory = 'work' | 'home' | 'health' | 'projects' | 'admin' | 'learning' | 'family';
export type TaskStatus = 'inbox' | 'todo' | 'doing' | 'done';
export type Priority = 'high' | 'medium' | 'low';

export interface Task extends Doc {
  title: string;
  notes?: string;
  category: TaskCategory;
  status: TaskStatus;
  priority: Priority;
  urgent?: boolean;
  important?: boolean;
  /** One of the (max three) essentials protected today. */
  essential?: boolean;
  dueDate?: ISODate | ISODateTime | null;
  estimateMinutes?: number;
  scheduledFor?: 'today' | 'week' | null;
  projectId?: string | null;
  goalId?: string | null;
  source?: SourceRef | null;
  completedAt?: ISODateTime | null;
}

export interface Milestone {
  id: string;
  title: string;
  done: boolean;
  dueDate?: ISODate | null;
}

export interface Project extends Doc {
  name: string;
  description?: string;
  client?: string;
  status: 'active' | 'paused' | 'done';
  dueDate?: ISODate | null;
  value?: number | null; // expected revenue, in minor units
  milestones: Milestone[];
  /** The goal this project serves (goal → project → action chain). */
  goalId?: string | null;
}

export interface FinanceEntry extends Doc {
  date: ISODate;
  kind: 'income' | 'expense';
  /** Amount in minor units (cents) to avoid floating-point drift. */
  amount: number;
  currency: Currency;
  category: string;
  label: string;
  counterparty?: string;
  status: 'paid' | 'pending' | 'overdue';
  taxRelevant?: boolean;
  dueDate?: ISODate | null;
}

export type HealthSource = 'manual' | 'import' | 'apple-health' | 'health-connect' | 'samsung-health';

export interface HealthMetric extends Doc {
  date: ISODate;
  sleepHours?: number | null;
  energy?: number | null; // 1..5, self-reported
  stress?: number | null; // 1..5, self-reported
  steps?: number | null;
  activeMinutes?: number | null;
  restingHeartRate?: number | null;
  source: HealthSource;
}

export interface JournalEntry extends Doc {
  date: ISODate;
  kind: 'reflection' | 'milestone' | 'learning';
  text: string;
  mood?: number | null; // 1..5
  tags: string[];
}

export type ResourceType = 'book' | 'course' | 'video' | 'podcast' | 'article';

export interface LearningResource {
  id: string;
  title: string;
  type: ResourceType;
  url?: string;
  status: 'todo' | 'doing' | 'done';
}

export interface Skill extends Doc {
  name: string;
  target: string;
  progress: number; // 0..100, self-assessed or evidence based
  lastPracticedAt?: ISODateTime | null;
  nextReviewAt?: ISODate | null;
  reviewIntervalDays?: number;
  resources: LearningResource[];
}

export interface CalendarEvent extends Doc {
  title: string;
  start: ISODateTime;
  end: ISODateTime;
  allDay?: boolean;
  location?: string;
  description?: string;
  source?: SourceRef | null;
}

export interface Habit extends Doc {
  name: string;
  cadence: 'daily' | 'weekdays' | 'weekly';
  domain: 'work' | 'health' | 'learning' | 'personal';
  archived?: boolean;
}

export interface HabitLog extends Doc {
  habitId: string;
  date: ISODate;
}

export interface Goal extends Doc {
  title: string;
  why?: string;
  horizon: 'week' | 'month' | 'quarter' | 'year';
  metric?: string;
  targetValue?: number | null;
  currentValue?: number | null;
  dueDate?: ISODate | null;
  status: 'active' | 'achieved' | 'dropped';
}

export type RelationshipType =
  | 'strategic_client'
  | 'client'
  | 'active_prospect'
  | 'partner'
  | 'manager'
  | 'colleague'
  | 'candidate'
  | 'community'
  | 'unknown'
  | 'vendor'
  | 'automated'
  | 'marketing';

export interface Contact extends Doc {
  name: string;
  email?: string;
  relationshipType: RelationshipType;
  notes?: string;
}

export type MailProvider = 'gmail' | 'outlook' | 'imap';

export interface MailAccount extends Doc {
  provider: MailProvider;
  email: string;
  displayName?: string;
  imapPreset?: 'yahoo' | 'gmx' | 'icloud' | 'custom';
  status: 'connected' | 'needs-auth' | 'error' | 'disconnected';
  lastSyncAt?: ISODateTime | null;
  error?: string | null;
}

export interface MailMessage extends Doc {
  accountId: string;
  provider: MailProvider;
  externalId: string;
  threadId?: string;
  subject: string;
  sender: string;
  senderEmail?: string;
  snippet: string;
  receivedAt: ISODateTime;
  unread: boolean;
  needsReply: boolean;
  importance: 'high' | 'normal' | 'low';
  url?: string;
  resolved?: boolean;
}

export type SocialProvider = 'linkedin' | 'x' | 'tiktok' | 'youtube' | 'meta';

export interface SocialAccount extends Doc {
  provider: SocialProvider;
  handle: string;
  status: 'connected' | 'needs-auth' | 'approval-required' | 'error' | 'disconnected';
  capabilities: string[];
  lastSyncAt?: ISODateTime | null;
  error?: string | null;
}

export interface SocialItem extends Doc {
  provider: SocialProvider;
  accountId: string;
  externalId: string;
  kind: 'comment' | 'mention' | 'message' | 'post' | 'video';
  author: string;
  text: string;
  url?: string;
  publishedAt: ISODateTime;
  needsReply: boolean;
  resolved?: boolean;
  metrics?: Record<string, number>;
}

export interface HouseholdMember extends Doc {
  name: string;
  relation: 'child' | 'partner' | 'parent' | 'other';
  /** Minors: only a first name and school context are stored (data minimisation). */
  school?: string;
  notes?: string;
}

export interface SchoolItem extends Doc {
  memberId: string;
  title: string;
  kind: 'homework' | 'exam' | 'form' | 'meeting' | 'activity';
  dueDate?: ISODate | null;
  done: boolean;
}

export type ApplicationStage = 'wishlist' | 'applied' | 'interview' | 'offer' | 'rejected' | 'accepted';

export interface JobApplication extends Doc {
  company: string;
  role: string;
  stage: ApplicationStage;
  appliedAt?: ISODate | null;
  nextAction?: string;
  nextActionAt?: ISODate | null;
  url?: string;
  notes?: string;
}

export interface Checkin extends Doc {
  weekOf: ISODate;
  wins: string;
  blockers: string;
  energy: number; // 1..5
  focusNext: string;
}

export type FeedbackAction = 'accepted' | 'rejected' | 'deferred' | 'completed' | 'wrongTime';

export interface DecisionFeedback extends Doc {
  signalId: string;
  action: FeedbackAction;
  sourceType: string;
  intent?: string;
  category?: string;
  relationshipType?: string;
  hour: number;
  /** Real minutes spent (focus timer) and the estimate at the time, for calibration. */
  minutes?: number | null;
  estimate?: number | null;
}

export interface CoachMessage extends Doc {
  role: 'user' | 'assistant';
  text: string;
  meta?: {
    intent?: string;
    usedSources?: string[];
    confidence?: 'low' | 'medium' | 'high';
    enhancedBy?: string | null;
    actions?: { key: string; route: string }[];
    /** Changes the coach proposes; applied only after confirmation. */
    proposal?: { id: string; title: string; to: ISODate }[];
    applied?: boolean;
  };
}

export type Domain =
  'mail' | 'social' | 'health' | 'finance' | 'journal' | 'learning' | 'calendar' | 'household' | 'career';

export interface ContextProfile {
  primaryGoal: string;
  secondaryGoal: string;
  successDefinition: string;
  weeklyHours: number;
  focusHours: number;
  energyPeak: 'morning' | 'afternoon' | 'evening';
  workDays: ('mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun')[];
  workStart: string; // HH:MM
  workEnd: string; // HH:MM
  fixedCommitments: string;
  constraints: string;
  coachingTone: 'direct' | 'balanced' | 'gentle';
  coachingDepth: 'brief' | 'detailed';
  allowCrossAnalysis: boolean;
  includedDomains: Record<Domain, boolean>;
}

export interface AiPreferences {
  semantic: boolean;
  browserModel: boolean;
  gateway: boolean;
  gatewayUrl: string;
}

export interface Settings {
  name: string;
  edition: EditionKey;
  locale: Locale;
  currency: Currency;
  theme: 'system' | 'light' | 'dark';
  onboardingComplete: boolean;
  context: ContextProfile;
  ai: AiPreferences;
  notifications: boolean;
  consent: {
    /** ISO timestamp of explicit, separate consent to process health data (GDPR art. 9). */
    health: ISODateTime | null;
    cloudSync: ISODateTime | null;
  };
  usage: {
    coachDate: ISODate;
    coachCount: number;
    eveningDone?: ISODate | null;
    /** "My day has changed": today's constraints, reset automatically the next day. */
    day?: {
      date: ISODate;
      energy?: 'low' | 'normal' | 'high';
      minutesLeft?: number | null;
      endAt?: string | null;
    } | null;
  };
  schemaVersion: number;
}

/* -------------------------------- missions -------------------------------- */

/**
 * A mission is a goal with a date or a rhythm (exam, interview, book, fitness…).
 * Only the inputs and the history are stored; the plan and the forecast are
 * recomputed deterministically by domain/missions.ts, so they always adapt.
 */
export type MissionKind =
  'exam' | 'interview' | 'book' | 'fitness' | 'language' | 'presentation' | 'jobsearch';

/** One application tracked by a job-search mission. */
export interface PipelineItem {
  id: string;
  company: string;
  role: string;
  stage: ApplicationStage;
  appliedAt?: ISODate | null;
  /** Last follow-up sent (relance). */
  followedUpAt?: ISODate | null;
  url?: string;
}

export interface MissionTopic {
  id: string;
  title: string;
  /** Self-assessed mastery when the mission starts, 1 (new) … 5 (mastered). */
  mastery: number;
}

export interface MissionLogEntry {
  date: ISODate;
  minutes: number;
  topicId?: string | null;
  step?: string | null;
  rating?: 'easy' | 'good' | 'hard' | null;
  /** Book: page reached at the end of the session. */
  page?: number | null;
}

export interface Mission extends Doc {
  kind: MissionKind;
  title: string;
  targetDate?: ISODate | null;
  status: 'active' | 'done' | 'archived';
  minutesPerDay: number;
  daysPerWeek: number;
  topics: MissionTopic[];
  totalPages?: number | null;
  startPage?: number | null;
  level?: 'beginner' | 'intermediate' | 'advanced' | null;
  /** Exam prepared for a family member (e.g. a child's test). */
  forName?: string | null;
  /** Job search: the applications being tracked. */
  pipeline?: PipelineItem[];
  /** The goal this mission serves. */
  goalId?: string | null;
  log: MissionLogEntry[];
  notes?: string;
}

export interface CollectionMap {
  tasks: Task;
  projects: Project;
  finance: FinanceEntry;
  health: HealthMetric;
  journal: JournalEntry;
  skills: Skill;
  events: CalendarEvent;
  habits: Habit;
  habitLogs: HabitLog;
  goals: Goal;
  contacts: Contact;
  mailAccounts: MailAccount;
  mailMessages: MailMessage;
  socialAccounts: SocialAccount;
  socialItems: SocialItem;
  household: HouseholdMember;
  schoolItems: SchoolItem;
  applications: JobApplication;
  checkins: Checkin;
  feedback: DecisionFeedback;
  coachMessages: CoachMessage;
  missions: Mission;
}

export type CollectionName = keyof CollectionMap;

export const COLLECTIONS: readonly CollectionName[] = [
  'tasks',
  'projects',
  'finance',
  'health',
  'journal',
  'skills',
  'events',
  'habits',
  'habitLogs',
  'goals',
  'contacts',
  'mailAccounts',
  'mailMessages',
  'socialAccounts',
  'socialItems',
  'household',
  'schoolItems',
  'applications',
  'checkins',
  'feedback',
  'coachMessages',
  'missions',
] as const;

/**
 * Collections that never leave the device. Provider caches (mail bodies, social
 * items) stay local so Σ never stores third-party message content server-side.
 */
export const LOCAL_ONLY_COLLECTIONS: ReadonlySet<CollectionName> = new Set([
  'mailMessages',
  'socialItems',
  'coachMessages',
]);

/** Collections containing special-category data (GDPR art. 9); synced only with explicit consent. */
export const SENSITIVE_COLLECTIONS: ReadonlySet<CollectionName> = new Set(['health']);

export type Snapshot = { [K in CollectionName]: CollectionMap[K][] };
