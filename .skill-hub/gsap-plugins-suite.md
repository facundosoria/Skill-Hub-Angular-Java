---
slug: gsap-plugins-suite
title: GSAP Plugins Suite
description: 'Rules for GSAP plugins: ScrollToPlugin for smooth scrolling, Flip for layout transitions,
  Observer.'
when_to_use: using GSAP plugins, smooth scrolling with ScrollToPlugin, Flip layout animation, Observer
  gestures
stack: angular
type: skill
owning_team: admin
version: 1
tags:
- animation
- flip
- frontend
- gsap
- plugins
- scrollto
- smooth-scroll
---

## Rule

Always register GSAP plugins globally once using `gsap.registerPlugin()` and leverage `ScrollToPlugin` for smooth navigation and `Flip` for layout transitions.

### Smooth In-Page Scrolling (ScrollToPlugin)
- Registration: Call `gsap.registerPlugin(ScrollToPlugin)` once.
- Smooth Scroll Execution:
  `gsap.to(window, { duration: 0.6, scrollTo: { y: targetElementOrSelector, offsetY: 80 }, ease: 'power2.out' });`
- Eliminates abrupt instant jumping when clicking sidebar Table of Contents links.

### Dynamic Active Indicators (Flip & CSS Transitions)
- Sliding pill / indicator: Animate the active sidebar indicator seamlessly when jumping between sections using `Flip` or animated `transform` tweens (`gsap.to(indicator, { y: targetOffset, duration: 0.25, ease: 'power2.out' })`).
- Always respect accessibility and reduced motion with `gsap.matchMedia()`.
