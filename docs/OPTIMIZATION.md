# Optimizing the day-of coverage problem

The chief asked (9/28/2026) to "refer to online resources to see how we may be
able to best optimize this scheduling problem". This note places the problem
in the operations-research literature, says what the app now does, and lists
what it does not do yet. Sources and what was checked are at the end.

## What kind of problem this is

The posted schedule already exists. During the day a few urgent add-on
cases arrive, each with its own time and an estimated length. Each case type
has a written priority chain (the how-to doc). A resident can take two
add-ons only if their times do not overlap. Whoever is pulled out of a clinic
leaves a gap, and a second chain says who covers it.

In operations-research terms that is:

- **Same-day re-planning of a small personnel schedule.** Physician and
  resident scheduling is a studied field of its own (Erhard et al. 2018),
  next to operating-room planning and scheduling (Cardoen et al. 2010).
  Fitting add-ons into open time has been treated as bin packing
  (Dexter et al. 1999).
- **Minimal-change repair.** Re-rostering after a disruption looks for "a
  feasible roster having the minimal number of changes with respect to the
  original one" (Bäumelt et al. 2016). Here the posted schedule stays as it
  is. Only add-on picks and clinic covers are added.
- **An assignment problem.** When all the add-ons overlap in time, each
  resident takes at most one. With cost = rank in the chain, that is the
  classic assignment problem, which the Hungarian method solves exactly
  (Kuhn 1955). When times differ, it becomes an assignment with a no-overlap
  rule per resident. Constraint solvers model that directly, with an optional
  interval per (add-on, resident) and a NoOverlap per resident (OR-Tools
  CP-SAT docs).
- **More than one objective, in a fixed order.** First, cover every add-on
  if at all possible. Then respect the doc's order. Lexicographic
  optimization solves the top objective, fixes it, then solves the next
  (HiGHS docs). Weights that make a single weighted sum equivalent exist
  (Sherali 1982), but the ordered form is easier to audit.
- **What "respect the order" means is a real choice.** A rank-maximal
  matching gives as many cases as possible their first choice, then their
  second, and so on (Irving et al. 2006). A minimum-sum assignment minimizes
  the total chain rank. Going case by case in a priority order, as the doc
  does, is a third option. These can give different answers.

## What the app does (Coverage → "If add-ons come in")

1. **Every add-on has its own time.** Two add-ons conflict only if their
   estimated times overlap. Clinic cover only excludes someone who is taking
   an add-on at that time.
2. **The doc's order stays the rule.**
   - Step 6 add-ons (glaucoma → Surg 4, cornea → Surg 3) are placed first,
     then Step 9 (trauma, then plastics), each down its chain.
   - Anything skipped goes, in time order, down Step 10's chain.
   - Chosen deliberately: the doc's case-by-case priority order, not
     rank-maximal and not minimum-sum.
3. **It searches exactly.**
   - A depth-first search tries the same choices in the doc's preference
     order.
   - The first complete answer it reaches is the doc's own plain order.
   - It keeps looking only while some add-on has nobody, and keeps the first
     answer that covers more (branch and bound; the objective is coverage
     first, then the doc's order).
   - The problem is tiny (a handful of add-ons, about six people per chain),
     so this takes a few dozen steps. A cap of 50,000 steps is a safety net.
4. **It says when it departs from the order**, e.g. "Globe 1:00 PM: Calotti
   (the order alone: nobody); Glaucoma add-on 1:30 PM: Cheng (the order
   alone: Calotti)". That is the case where Surg 4 is the only person free
   for the globe and Surg 1's list ends at 1:30.
5. **Clinic cover (Step 12) comes after**, earliest first, down the chain,
   and never gives one coverer two clinics at once.

The Surgery tab still applies the plain order to the whole day's list. That
is the doc's procedure, and there the scheduler can see and override every
suggestion.

## Not done (candidates, in order of value)

- **Fewest clinic gaps as a third objective.** Among equally good answers,
  prefer residents whose leaving needs no cover. Today the chain order
  decides (Surg 2 still takes the globe from clinic).
- **Whole-day re-planning** when several things change at once. The natural
  tool is a CP-SAT model: intervals, NoOverlap, and the doc's chains as
  ordered objectives. It would be heavier and harder to audit than the
  doc's step-by-step walk.
- **Uncertain case lengths.** The durations are estimates (cataract 30 min,
  trauma 120 …), and a plan can look feasible on paper and fail in the OR.
  Planning with a buffer, or re-planning as soon as a case runs late (the
  "running late" card already does the second for mornings), both help.

## What would break it

- **Estimated durations.** An add-on that runs long can overlap a later one
  the plan gave to the same resident.
- **The chains encode order, not willingness or skill.** "Free and willing
  junior at Surg 2's discretion" still needs Surg 2.
- **The order choice.** If the chief prefers "most first choices" (rank-
  maximal) over "earlier steps choose first", the answer can change in rare
  multi-add-on cases.

## Sources, and what was checked

Publisher sites (doi.org, ScienceDirect, PubMed, Wiley,
developers.google.com) were blocked from the build environment.

- **Bibliographic details** were checked against fetched records: the DBLP
  YAML mirror on GitHub, the SciPy 1.0 paper's bib file, a Scopus export,
  and the authors' README.
- **OR-Tools and HiGHS** are their official docs on GitHub, read directly.
- **Beyond titles**, only the Bäumelt et al. abstract and the rank-maximal
  definition were read (from mirrored copies). The papers themselves were
  not.

- Bäumelt Z, et al. A novel approach for nurse rerostering based on a
  parallel algorithm. *European Journal of Operational Research* 2016.
  doi:10.1016/j.ejor.2015.11.022. (Abstract read; volume and pages not
  checked.)
- Cardoen B, Demeulemeester E, Beliën J. Operating room planning and
  scheduling: A literature review. *EJOR* 2010;201(3):921–932.
  doi:10.1016/j.ejor.2009.04.011.
- Cohn A, Root S, Kymissis C, Esses J, Westmoreland N. Scheduling medical
  residents at Boston University School of Medicine. *Interfaces*
  2009;39(3):186–195. doi:10.1287/inte.1080.0369. (A residency-scheduling
  precedent; contents not read.)
- Dexter F, Macario A, Traub RD. Which algorithm for scheduling add-on
  elective cases maximizes operating room utilization? Use of bin-packing
  algorithms and fuzzy constraints in operating room management.
  *Anesthesiology* 1999;91(5):1491–1500. doi:10.1097/00000542-199911000-00043.
  (About elective add-ons, not emergencies.)
- Erhard M, Schoenfelder J, Fügener A, Brunner JO. State of the art in
  physician scheduling. *EJOR* 2018;265(1):1–18. doi:10.1016/j.ejor.2017.06.037.
- Irving RW, Kavitha T, Mehlhorn K, Michail D, Paluch KE. Rank-maximal
  matchings. *ACM Transactions on Algorithms* 2006;2(4):602–610.
  doi:10.1145/1198513.1198520.
- Kuhn HW. The Hungarian method for the assignment problem. *Naval Research
  Logistics* 1955;2(1–2):83–97 (as the SciPy bib file gives it).
- Sherali HD. Equivalent weights for lexicographic multi-objective programs:
  characterizations and computations. *EJOR* 1982;11(4):367–379.
  doi:10.1016/0377-2217(82)90202-8.
- Google OR-Tools. Scheduling recipes for the CP-SAT solver
  (ortools/sat/docs/scheduling.md, GitHub). Quoted: "A no_overlap
  constraint simply states that all intervals are disjoint", and optional
  intervals have a presence literal that NoOverlap "correctly ignore[s]"
  when inactive.
- HiGHS. Lexicographic optimization of multiple linear objectives
  (docs/src/guide/further.md, GitHub). Optimize the highest-priority
  objective, bound it within a tolerance, and repeat down the list;
  "all priority values must be distinct".
