import { AnimDelayPipe } from './anim-delay.pipe';

describe('AnimDelayPipe', () => {
  const pipe = new AnimDelayPipe();

  it('staggers by index with the default step', () => {
    expect(pipe.transform(0)).toBe('0ms');
    expect(pipe.transform(3)).toBe('72ms');
  });

  it('caps long lists', () => {
    expect(pipe.transform(50)).toBe(`${12 * 24}ms`);
    expect(pipe.transform(50, 10, 2)).toBe('20ms');
  });
});
