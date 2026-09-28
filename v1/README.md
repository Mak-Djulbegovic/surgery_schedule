# Surg Schedule Builder — v1 (archived)

`index.html` is the whole v1 app in one file — open it in any browser, or on
the hosted site at `/v1/`. It is the single-file build of
[commit `29d8fa0`](https://github.com/Mak-Djulbegovic/surgery_schedule/tree/29d8fa0c5d68247da914be06cda35fbb9bb73b45)
(main before the v2 redesign), with two changes:

- the page title says "(v1)";
- saved days live under their own browser-storage keys
  (`surgsched:v1archive:*`). v1 and v2 would otherwise share keys, and
  editing a day in v1 would silently drop what only v2 stores (who is out,
  "done by" times). The flip side: this copy starts with no saved days.

For the exact v1 source: `git checkout 29d8fa0`. To give it a name on
GitHub, create a release/tag `v1` at that commit (Releases → Draft a new
release → tag `v1` → target `29d8fa0`, or `main` before v2 is merged).
