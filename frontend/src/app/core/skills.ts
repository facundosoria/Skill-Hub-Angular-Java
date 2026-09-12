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

  create(values: SkillFormValues, file: File | null): Promise<SkillMutationResult> {
    return firstValueFrom(this.api.postForm<SkillMutationResult>('/skills', packageForm(values, file)));
  }

  update(slug: string, values: SkillFormValues, file: File | null): Promise<SkillMutationResult> {
    return firstValueFrom(this.api.putForm<SkillMutationResult>(`/skills/${slug}`, packageForm(values, file)));
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
  }): Promise<LanguageFlag | null> {
    return firstValueFrom(this.api.post<LanguageFlag | null>('/skills/check-language', fields));
  }
}

function packageForm(values: SkillFormValues, file: File | null): FormData {
  const form = new FormData();
  form.append('metadata', new Blob([JSON.stringify(values)], { type: 'application/json' }));
  if (file) form.append('file', file, file.name);
  return form;
}
