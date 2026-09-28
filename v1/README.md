# Surg Schedule Builder — v1 (archived)

`index.html` is the whole v1 app in one file — open it in any browser, or on
the hosted site at `/v1/`. It is the single-file build of git tag
[`v1`](https://github.com/Mak-Djulbegovic/surgery_schedule/tree/v1)
(main at commit `29d8fa0`, before the v2 redesign), with two changes:

- the page title says "(v1)";
- saved days live under their own browser-storage keys
  (`surgsched:v1archive:*`). v1 and v2 would otherwise share keys, and
  editing a day in v1 would silently drop what only v2 stores (who is out,
  "done by" times). The flip side: this copy starts with no saved days.

For the exact v1 source, check out the tag: `git checkout v1`.
