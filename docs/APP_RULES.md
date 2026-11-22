# App boundary rules

The platform is one build made of separate apps. They stay separate by following four rules, which `npm run check:boundaries` enforces and `npm run build` runs first.

| Code in | May import |
|---|---|
| `src/apps/<app>` | itself and `src/core` |
| `src/core` | `src/core` only |
| `src/shell` | `src/core` and any app (it holds the list of apps) |
| `src/main.tsx` | `src/shell` only |

An app never imports another app, and never imports the shell.

**When two apps need the same thing**
- Shared screens or helpers: move them into `src/core`.
- Data from another app: call a named database function (never read the other app's tables). Cross-app events come later through the events outbox.

**Database side (same idea)**
- Tables carry the app's prefix: `lv_`, `qv_`, `dv_`, `dr_`, `iv_`, `sc_`, `cp_`.
- An app's code reads only its own prefix plus shared core tables.

**Adding an app**
1. Create `src/apps/<name>/Root.tsx` with a default export.
2. Add one entry to `src/shell/apps.ts`.
3. Run `npm run check:boundaries`.
