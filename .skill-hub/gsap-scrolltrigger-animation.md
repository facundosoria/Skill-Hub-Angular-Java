---
slug: gsap-scrolltrigger-animation
title: GSAP ScrollTrigger Animation
description: Rules for scroll-linked animations, scrubbing, section pinning, and scroll-triggered transitions.
when_to_use: scroll-linked animation, ScrollTrigger, smooth scrolling, section pinning, scrub transition
stack: angular
type: skill
owning_team: admin
version: 1
tags:
- animation
- frontend
- gsap
- motion
- scroll
- scrolltrigger
---

## Rule

Always register ScrollTrigger via `gsap.registerPlugin(ScrollTrigger)` and link scroll-driven animations with explicit start, end, and toggleActions.

### ScrollTrigger Configuration
- Plugin Registration: Call `gsap.registerPlugin(ScrollTrigger)` once in the application or feature initializer.
- Trigger Points: Define `start` and `end` points with trigger and viewport positions (e.g. `start: 'top 80%'`, `end: 'bottom 20%'`).
- Smooth Scrolling (Scrub): Use `scrub: true` or a smoothing delay like `scrub: 0.5` to link animation progress to scroll displacement.
- Container Scroller: When scrolling a sidebar or pane with `overflow-y: auto`, define `scroller: containerElement`.

### Component Lifecycle Cleanup
- In Angular components, clean up active ScrollTrigger instances on destroy using `ScrollTrigger.killAll()` or scoped `gsap.context()` cleanup.
