---
slug: gsap-core-animation
title: GSAP Core Animation Engine
description: 'Core rules for GreenSock animation: tweens, easings, staggers, and responsive matchMedia.'
when_to_use: animating UI with GSAP, creating tweens, gsap.to, gsap.from, easing curves, stagger animations
stack: angular
type: skill
owning_team: admin
version: 1
tags:
- animation
- frontend
- gsap
- motion
- skill
- transitions
---

## Rule

Always use GSAP core methods (`gsap.to()`, `gsap.from()`, `gsap.fromTo()`) with camelCase properties, explicit durations, and clean lifecycle management.

### Core Methods and Options
- `gsap.to(target, vars)`: Animates elements from current values to target values.
- `gsap.from(target, vars)`: Animates elements from defined values to their natural CSS layout state.
- Always specify duration explicitly in seconds (e.g. `duration: 0.4`).
- Use standard easing functions: `power2.out`, `power3.inOut`, `back.out(1.4)`.

### Lifecycle and Cleanup in Angular
- Store tween references and kill them during component destruction (`ngOnDestroy` or `DestroyRef`).
- Use `gsap.context()` to scope animations to a component root element and enable one-line cleanup.
