import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { Api } from './api';
import { InfraService } from './infra';

describe('InfraService', () => {
  it('reads GET /infra/state', () => {
    const state = { enabled: true };
    const api = { get: vi.fn(() => of(state)) };
    TestBed.configureTestingModule({ providers: [{ provide: Api, useValue: api }] });

    let received: unknown;
    TestBed.inject(InfraService)
      .state()
      .subscribe((value) => (received = value));

    expect(api.get).toHaveBeenCalledWith('/infra/state');
    expect(received).toBe(state);
  });
});
