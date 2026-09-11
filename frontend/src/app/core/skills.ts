import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { Api } from './api';
import type {
  DuplicateCandidate,
  LanguageFlag,
  SkillDetail,
  SkillFormValues,
  SkillListItem,
  SkillMutationResult,
} from './models';

/** Puerto de src/server/skills/* (lado cliente): todo pasa por /api/skills. */
@Injectable({ providedIn: 'root' })
export class SkillService {
  private api = inject(Api);

  list(filters?: { stack?: string; type?: string; status?: string }): Promise<SkillListItem[]> {
    return firstValueFrom(
      this.api.get<{ skills: SkillListItem[] }>('/skills', filters),
    ).then((r) => r.skills);
  }

  get(slug: string, version?: number): Promise<SkillDetail> {
    return firstValueFrom(this.api.get<SkillDetail>(`/skills/${slug}`, { v: version }));
  }

  diff(slug: string, a: number, b: number): Promise<{ from: unknown; to: unknown }> {
    return firstValueFrom(this.api.get(`/skills/${slug}/diff`, { a, b }));
  }

  create(values: SkillFormValues): Promise<SkillMutationResult> {
    return firstValueFrom(this.api.post<SkillMutationResult>('/skills', values));
  }

  update(slug: string, values: SkillFormValues): Promise<SkillMutationResult> {
    return firstValueFrom(this.api.put<SkillMutationResult>(`/skills/${slug}`, values));
  }

  publish(slug: string): Promise<unknown> {
    return firstValueFrom(this.api.post(`/skills/${slug}/publish`));
  }

  deprecate(slug: string, supersededBy: string | null): Promise<unknown> {
    return firstValueFrom(this.api.post(`/skills/${slug}/deprecate`, { supersededBy }));
  }

  vote(slug: string): Promise<{ votes: number; required: number; applied: boolean }> {
    return firstValueFrom(this.api.post(`/skills/${slug}/vote`));
  }

  applyEdit(slug: string): Promise<unknown> {
    return firstValueFrom(this.api.post(`/skills/${slug}/apply-edit`));
  }

  discardEdit(slug: string): Promise<unknown> {
    return firstValueFrom(this.api.post(`/skills/${slug}/discard-edit`));
  }

  checkDuplicates(title: string, tags: string[]): Promise<DuplicateCandidate[]> {
    return firstValueFrom(
      this.api.get<DuplicateCandidate[]>('/skills/duplicates', {
        title,
        tags: tags.join(','),
      }),
    );
  }

  checkLanguage(fields: {
    title: string;
    description: string;
    whenToUse: string;
    content: string;
  }): Promise<LanguageFlag> {
    return firstValueFrom(this.api.post<LanguageFlag>('/skills/check-language', fields));
  }
}
