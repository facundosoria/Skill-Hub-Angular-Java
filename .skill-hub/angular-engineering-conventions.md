---
slug: angular-engineering-conventions
title: Angular Engineering Conventions
description: 'Standards for Angular development: standalone components, signals, inject function, and
  OnPush.'
when_to_use: writing Angular components, Angular services, reactive signals, inject dependency injection
stack: angular
type: convention
owning_team: admin
version: 1
tags:
- angular
- convention
- frontend
- signals
- standalone
- typescript
---

## Rule

Always write modern Angular using standalone components, reactive signals, dependency injection via `inject()`, and `ChangeDetectionStrategy.OnPush`.

### Component Standards
- Standalone: All components, directives, and pipes must be standalone.
- Change Detection: Explicitly declare `changeDetection: ChangeDetectionStrategy.OnPush`.
- Dependency Injection: Use `private readonly service = inject(ServiceName);` instead of constructor arguments.

### Reactivity and Templates
- Signals: Model internal and derived state using `signal()` and `computed()`.
- Built-in Control Flow: Use `@if`, `@for`, and `@switch` blocks exclusively. Avoid legacy `*ngIf` and `*ngFor`.
- Build Verification: Always verify changes locally with `npm run build` inside the frontend directory.
