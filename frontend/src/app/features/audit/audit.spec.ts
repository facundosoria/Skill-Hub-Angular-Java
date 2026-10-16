import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { Api } from '../../core/api';
import type { AuditEvent } from '../../core/models';
import { Audit } from './audit';

describe('Audit', () => {
  const api = { get: vi.fn() };

  beforeEach(() => {
    api.get.mockReset();
    TestBed.configureTestingModule({
      imports: [Audit],
      providers: [provideRouter([]), { provide: Api, useValue: api }],
    });
  });

  async function render(events: AuditEvent[]) {
    api.get.mockReturnValue(of({ events }));
    const fixture = TestBed.createComponent(Audit);
    await new Promise((resolve) => setTimeout(resolve));
    fixture.detectChanges();
    return { fixture, component: fixture.componentInstance, el: fixture.nativeElement as HTMLElement };
  }

  it('shows the empty state without events', async () => {
    const { el } = await render([]);
    expect(api.get).toHaveBeenCalledWith('/audit');
    expect(el.querySelector('ui-empty-state')).not.toBeNull();
  });

  it('lists events with actor, badge and skill link', async () => {
    const { el, component } = await render([
      event({ id: '1', action: 'skill.published', actorName: 'Ana', actorTeam: 'Banco', metadata: '{"slug":"java-api"}' }),
      event({ id: '2', action: 'custom.action', actorSnapshot: '{"name":"Snap"}' }),
      event({ id: '3', action: 'skill.proposed', actorSnapshot: 'not json', metadata: '{bad' }),
    ]);

    expect(el.textContent).toContain('Ana');
    expect(el.textContent).toContain('Banco');
    expect(el.textContent).toContain('Snap');
    expect(el.textContent).toContain(component.t().audit.sistema);
    expect(el.textContent).toContain('custom.action');
    expect(el.querySelector('a[href="/skills/java-api"]')).not.toBeNull();
    expect(el.textContent).toContain('2026-01-02T03:04');
    expect(component.tone('skill.published')).toBe('success');
    expect(component.tone('other')).toBe('neutral');
    expect(component.slug(event({ metadata: '{"slug":1}' }))).toBeNull();
    expect(component.slug(event({ metadata: null }))).toBeNull();
  });
});

function event(overrides: Partial<AuditEvent> = {}): AuditEvent {
  return {
    id: 'e',
    action: 'skill.published',
    targetType: 'skill',
    metadata: null,
    actorSnapshot: null,
    createdAt: '2026-01-02T03:04:05Z',
    actorId: null,
    actorName: null,
    actorUsername: null,
    actorTeam: null,
    actorRole: null,
    ...overrides,
  };
}
