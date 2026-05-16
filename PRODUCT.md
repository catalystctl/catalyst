# Product

## Register

product

## Users

Game server administrators, enterprise hosting operators, and community managers managing Minecraft, Rust, ARK, and similar game servers. They are technical, time-constrained, and often context-switching between multiple servers and tools. Primary workflows: server lifecycle management, real-time console monitoring, file editing, user/permission administration, and node deployment.

## Product Purpose

Catalyst is a complete game server management platform. It replaces fragmented tooling with a unified panel for creating, configuring, monitoring, and maintaining game servers across distributed nodes. Success means an administrator can deploy a server, edit its files, monitor its console, and manage permissions without leaving the panel — or reaching for SSH.

## Brand Personality

Clean. Fast. Modern.

- **Clean**: Every element earns its place. No decorative noise, no redundant chrome, no restated labels.
- **Fast**: UI feels immediate. Virtualized lists, optimistic updates, keyboard shortcuts, and zero blocking modals for routine actions.
- **Modern**: Contemporary without chasing trends. Current-era interaction patterns, not nostalgia-driven skeuomorphism or gimmicky effects.

Voice is direct and expert. Assume technical competence. No hand-holding copy.

## Anti-references

- **AI slop**: Generic gradient-text heroes, glassmorphism cards, identical icon-heading-text grids, decorative side-stripe borders, modal-first workflows, em dashes in copy, and any surface that screams "generated."
- **Gamer aesthetic**: Neon accents, aggressive gradients, dark-mode-by-default-because-gaming. The tool is infrastructure, not entertainment.
- **Bootstrap-era admin templates**: Dense data tables with every column, excessive chrome, no whitespace rhythm, form-over-function visual hierarchy.
- **Pterodactyl utilitarianism**: Functional but visually indifferent. Catalyst should be functional *and* considered.

## Design Principles

1. **Show, don't tell**: Status, progress, and state changes should be visible at a glance without reading labels. Icons carry meaning; color reinforces, never replaces.
2. **Speed is a feature**: The interface must feel as responsive as the underlying Rust agent. Loading states are skeletons, not spinners. Actions confirm inline, not via toast spam.
3. **Density with breathing room**: Information-rich surfaces are necessary for server management, but density without rhythm becomes noise. Vary spacing, group related actions, and let the eye rest.
4. **Progressive disclosure**: Advanced operations (permissions, bulk actions, archive management) are available but not in the way. The default view is the common path; power is one click or shortcut away.
5. **Consistency across contexts**: A file tree, a server list, and a permission grid should feel like the same product. Shared patterns for selection, sorting, search, and empty states reduce cognitive load.

## Accessibility & Inclusion

- WCAG 2.1 AA target
- Responsive from 320px to 4K — primary use is desktop workstations, but admins check servers from mobile in emergencies
- Respect `prefers-reduced-motion`
- Color is never the sole indicator of state; paired with icons, text, or shape
- Keyboard-navigable for power users who prefer not to mouse
