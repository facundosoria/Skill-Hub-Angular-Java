import { TestBed } from '@angular/core/testing';
import { SkillPreview } from './skill-preview';

describe('SkillPreview', () => {
  it('renders the HTML inside a sandbox without same-origin', () => {
    const fixture = TestBed.createComponent(SkillPreview);
    fixture.componentRef.setInput('html', '<p>demo</p>');
    fixture.detectChanges();

    const iframe = (fixture.nativeElement as HTMLElement).querySelector('iframe')!;
    expect(iframe.getAttribute('sandbox')).toBe('allow-scripts');
    expect(iframe.getAttribute('srcdoc')).toContain('<body><p>demo</p></body>');
    expect(fixture.nativeElement.querySelector('.animate-pulse')).not.toBeNull();
  });

  it('hides the placeholder once the frame loads', () => {
    const fixture = TestBed.createComponent(SkillPreview);
    fixture.componentRef.setInput('html', '<p>demo</p>');
    fixture.detectChanges();

    fixture.nativeElement.querySelector('iframe').dispatchEvent(new Event('load'));
    fixture.detectChanges();

    expect(fixture.componentInstance.loaded()).toBe(true);
    expect(fixture.nativeElement.querySelector('.animate-pulse')).toBeNull();
  });
});
