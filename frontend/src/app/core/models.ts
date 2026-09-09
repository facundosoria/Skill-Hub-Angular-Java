/** Tipos de la API REST del backend Spring Boot (com.skillhub.web.*). */

export type Role = 'admin' | 'member';
export type Theme = 'system' | 'light' | 'dark';
export type Locale = 'es' | 'en';
export type Stack = 'angular' | 'java' | 'shared' | 'infra';
export type SkillType = 'skill' | 'convention' | 'reference';
export type SkillStatus = 'draft' | 'proposed' | 'published' | 'deprecated';

export interface User {
  id: string;
  username: string;
  name: string;
  team: string | null;
  role: Role;
}

export interface SkillListItem {
  slug: string;
  title: string;
  description: string;
  whenToUse: string;
  stack: Stack;
  type: SkillType;
  status: SkillStatus;
  ownerTeam: string | null;
  updatedAt: string;
  version: number;
  preview: string | null;
  usos90d: number;
  personas: number;
  actividad: number[];
  tags: string[];
  creatorName: string | null;
  creatorId: string | null;
}

export interface SkillVersion {
  version: number;
  content: string;
  preview: string | null;
}

export interface Skill {
  id: string;
  slug: string;
  title: string;
  description: string;
  whenToUse: string;
  stack: Stack;
  type: SkillType;
  status: SkillStatus;
  ownerTeam: string | null;
  origin: string;
  pendingVersionId: string | null;
  supersededBySlug: string | null;
  tags: string[];
  version: SkillVersion | null;
}

export interface VoteStatus {
  pendingVersionId: string | null;
  votes: number;
  required: number;
  yaVoto: boolean;
  esAutor: boolean;
}

export interface HistoryEntry {
  version: number;
  changelog: string | null;
  createdAt: string;
  authorName: string | null;
  authorUsername: string | null;
}

export interface RelatedSkill {
  slug: string;
  title: string;
  stack: Stack;
}

export interface SkillDetail {
  skill: Skill;
  history: HistoryEntry[];
  related: RelatedSkill[];
  voteStatus: VoteStatus | null;
}

export interface DuplicateCandidate {
  slug: string;
  title: string;
  description: string;
  stack: string;
  status: string;
  ownerTeam: string | null;
  version: number;
  supersededBySlug: string | null;
  usos90d: number;
  personas: number;
  similarity: number;
}

export interface LanguageFlag {
  campo: string;
  senales: string[];
}

/** Respuesta de POST/PUT /api/skills: exito o rechazo con detalle. */
export interface SkillMutationResult {
  slug?: string;
  version?: number;
  pending?: boolean;
  error?: string;
  idioma?: LanguageFlag;
  duplicates?: DuplicateCandidate[];
}

export interface SkillFormValues {
  slug: string;
  title: string;
  description: string;
  whenToUse: string;
  stack: Stack;
  type: SkillType;
  ownerTeam: string | null;
  tags: string[];
  content: string;
  changelog?: string | null;
  duplicateJustification?: string | null;
}

export interface ApiKey {
  id: string;
  name: string;
  prefix: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

export interface Proposal {
  slug: string;
  title: string;
  description: string;
  whenToUse: string;
  stack: string;
  ownerTeam: string | null;
  proposedFromQuery: string | null;
  createdAt: string;
  changelog: string | null;
  content: string;
  usos: number;
  personas: number;
}

/** Revisión que un agente propuso a una convención ya publicada (propose_revision). */
export interface RevisionProposal {
  slug: string;
  title: string;
  stack: string;
  ownerTeam: string | null;
  currentVersion: number | null;
  currentContent: string | null;
  proposedVersion: number;
  proposedContent: string | null;
  proposedSlug: string | null;
  proposedTitle: string | null;
  changelog: string | null;
  createdAt: string;
  authorName: string | null;
  usos: number;
}

export interface PendingUser {
  id: string;
  name: string;
  username: string;
  team: string | null;
  legajo: string | null;
  createdAt: string;
}

export interface AuditEvent {
  id: string;
  action: string;
  targetType: string;
  metadata: string | null;
  actorSnapshot: string | null;
  createdAt: string;
  actorId: string | null;
  actorName: string | null;
  actorUsername: string | null;
  actorTeam: string | null;
  actorRole: string | null;
}
