/** Tipos de la API REST del backend Spring Boot (com.skillhub.web.*). */

import type { Team } from './teams';

export type Role = 'admin' | 'member';
export type Theme = 'system' | 'light' | 'dark';
export type Locale = 'es' | 'en';
export type Stack = 'angular' | 'java' | 'shared' | 'infra';
export type SkillType = 'skill' | 'convention' | 'reference' | 'plugin' | 'contract';
export type SkillStatus = 'draft' | 'proposed' | 'published' | 'deprecated';

export interface User {
  id: string;
  username: string;
  name: string;
  team: Team | null;
  role: Role;
  mustChangePassword: boolean;
}

export interface SkillListItem {
  slug: string;
  title: string;
  description: string;
  whenToUse: string;
  stack: Stack;
  type: SkillType;
  status: SkillStatus;
  ownerTeam: Team | null;
  updatedAt: string;
  version: number;
  preview: string | null;
  usos90d: number;
  personas: number;
  actividad: number[];
  tags: string[];
  creatorName: string | null;
  creatorId: string | null;
  ratingAverage: number;
  ratingCount: number;
}

export interface SkillVersion {
  version: number;
  content: string;
  preview: string | null;
  artifact: CatalogArtifact | null;
}

export interface CatalogArtifact {
  fileName: string;
  contentType: string;
  sizeBytes: number;
  sha256: string;
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
  ownerTeam: Team | null;
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

export interface SkillRating {
  rating: number;
  comment: string;
  updatedAt: string;
  voterName: string;
}

export interface SkillDetail {
  skill: Skill;
  history: HistoryEntry[];
  related: RelatedSkill[];
  ratings: SkillRating[];
  voteStatus: VoteStatus | null;
}

export interface DuplicateCandidate {
  slug: string;
  title: string;
  description: string;
  stack: string;
  status: string;
  ownerTeam: Team | null;
  version: number;
  supersededBySlug: string | null;
  usos90d: number;
  personas: number;
  similarity: number;
}

/**
 * Resultado de clasificar el idioma de un skill: el catálogo acepta inglés o
 * español, pero no que un mismo skill mezcle campos de los dos.
 * `camposEnMinoria` lista los campos que quedaron del lado minoritario cuando
 * `consistente` es false — eso es lo único que bloquea.
 */
export interface LanguageFlag {
  idioma: 'es' | 'en';
  consistente: boolean;
  camposEnMinoria: string[];
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
  ownerTeam: Team | null;
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
  ownerTeam: Team | null;
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
  ownerTeam: Team | null;
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
  team: Team | null;
  legajo: string | null;
  createdAt: string;
}

export interface AdminUser extends PendingUser {
  role: Role;
  status: 'pending' | 'active' | 'rejected';
  mustChangePassword: boolean;
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
