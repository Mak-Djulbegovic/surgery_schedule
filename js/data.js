/*
 * Block schedule data — AY 2026–2027
 * Transcribed from the residency block schedule PDF and the
 * "How to Surgical Schedule" document.
 *
 * Naming: the PDF calls the classes First/Second/Third Year; in the app we use
 * PGY-2 / PGY-3 / PGY-4 respectively.
 *
 * Override rules: { block, day, session, nth: [..], months: [..], set, note }
 *   - nth: occurrence of that weekday within the month (1–5)
 *   - months: 1–12 calendar months the rule applies to (omit = all)
 *   - set: replacement assignment text (omit = note-only, keeps base text)
 */

const SCHED_DATA = {
  ayLabel: 'AY 2026–2027',
  ayStart: '2026-07-20',
  ayEnd: '2027-06-30',
  weekdays: ['mon', 'tue', 'wed', 'thu', 'fri'],

  years: {
    pgy2: {
      key: 'pgy2',
      label: 'PGY-2 (First Year)',
      short: 'PGY-2',
      residents: ['Ransone', 'Illiano', 'Patel', 'Marshall', 'Teng', 'Momenaei', 'Alvarez', 'Hamou'],
      taskmasterBlocks: [2, 5],
      blockRanges: [
        { start: '2026-07-20', end: '2026-08-30', blocks: { Ransone: 5, Illiano: 1, Patel: 4, Marshall: 6, Teng: 7, Momenaei: 3, Alvarez: 8, Hamou: 2 } },
        { start: '2026-08-31', end: '2026-10-11', blocks: { Ransone: 6, Illiano: 2, Patel: 5, Marshall: 7, Teng: 8, Momenaei: 4, Alvarez: 1, Hamou: 3 } },
        { start: '2026-10-12', end: '2026-11-22', blocks: { Ransone: 7, Illiano: 3, Patel: 6, Marshall: 8, Teng: 1, Momenaei: 5, Alvarez: 2, Hamou: 4 } },
        { start: '2026-11-23', end: '2027-01-17', blocks: { Ransone: 8, Illiano: 4, Patel: 7, Marshall: 1, Teng: 2, Momenaei: 6, Alvarez: 3, Hamou: 5 } },
        { start: '2027-01-18', end: '2027-02-28', blocks: { Ransone: 1, Illiano: 5, Patel: 8, Marshall: 2, Teng: 3, Momenaei: 7, Alvarez: 4, Hamou: 6 } },
        { start: '2027-03-01', end: '2027-04-11', blocks: { Ransone: 2, Illiano: 6, Patel: 1, Marshall: 3, Teng: 4, Momenaei: 8, Alvarez: 5, Hamou: 7 } },
        { start: '2027-04-12', end: '2027-05-23', blocks: { Ransone: 3, Illiano: 7, Patel: 2, Marshall: 4, Teng: 5, Momenaei: 1, Alvarez: 6, Hamou: 8 } },
        { start: '2027-05-24', end: '2027-06-30', blocks: { Ransone: 4, Illiano: 8, Patel: 3, Marshall: 5, Teng: 6, Momenaei: 2, Alvarez: 7, Hamou: 1 } }
      ],
      grid: {
        1: {
          mon: { am: 'Cooper Consults', pm: 'Cooper Consults' },
          tue: { am: 'Cooper Consults', pm: 'Cooper Consults' },
          wed: { am: 'Cooper Consults', pm: 'Cooper Consults' },
          thu: { am: 'Cooper Clinic', pm: 'Cooper Clinic' },
          fri: { am: 'Cooper Consults', pm: 'Cooper Consults' }
        },
        2: {
          mon: { am: 'CPEC', pm: 'CPEC' },
          tue: { am: 'CPEC', pm: 'CPEC' },
          wed: { am: 'ER', pm: 'ER' },
          thu: { am: 'CPEC', pm: 'CPEC' },
          fri: { am: 'CPEC', pm: 'CPEC' }
        },
        3: {
          mon: { am: 'Peds', pm: 'CPEC' },
          tue: { am: 'Peds', pm: 'CPEC' },
          wed: { am: 'Peds OR', pm: 'Cornea' },
          thu: { am: 'Cornea', pm: 'Peds' },
          fri: { am: 'Peds', pm: 'Cornea' }
        },
        4: {
          mon: { am: 'Path', pm: 'ER' },
          tue: { am: 'Path', pm: 'ER' },
          wed: { am: 'Path', pm: 'ER' },
          thu: { am: 'Path', pm: 'ER' },
          fri: { am: 'Path', pm: 'ER' }
        },
        5: {
          mon: { am: 'Uveitis', pm: 'Glaucoma' },
          tue: { am: 'Retina', pm: 'Glaucoma' },
          wed: { am: 'Retina', pm: 'Glaucoma' },
          thu: { am: 'CPEC', pm: 'Glaucoma' },
          fri: { am: 'Glaucoma Lasers', pm: 'PT' }
        },
        6: {
          mon: { am: 'CPEC', pm: 'Plastics' },
          tue: { am: 'Plastics OR', pm: 'Plastics' },
          wed: { am: 'CPEC', pm: 'Plastics' },
          thu: { am: 'Plastics', pm: 'Plastics OR' },
          fri: { am: 'CPEC', pm: 'Plastics' }
        },
        7: {
          mon: { am: 'Neuro', pm: 'Neuro' },
          tue: { am: 'Neuro', pm: 'Neuro' },
          wed: { am: 'Neuro', pm: 'CPEC' },
          thu: { am: 'Neuro', pm: 'Neuro' },
          fri: { am: 'Neuro', pm: 'CPEC' }
        },
        8: {
          mon: { am: 'ER', pm: 'ER' },
          tue: { am: 'ER', pm: 'ER' },
          wed: { am: 'CPEC', pm: 'CPEC' },
          thu: { am: 'ER', pm: 'ER' },
          fri: { am: 'ER', pm: 'ER' }
        }
      },
      overrides: [
        // Block 1: Cooper clinic 1st Wednesday and 4th Tuesday AM
        { block: 1, day: 'tue', session: 'am', nth: [4], set: 'Cooper Clinic', note: 'Cooper clinic 4th Tuesday AM' },
        { block: 1, day: 'wed', session: 'am', nth: [1], set: 'Cooper Clinic', note: 'Cooper clinic 1st Wednesday AM' },
        { block: 1, day: 'wed', session: 'am', note: 'Benson if not seeing consults' },
        // Block 3: Peds OR 4th Tues and 1st and 5th Fri of the month
        { block: 3, day: 'tue', session: 'am', nth: [4], set: 'Peds OR', note: 'Peds OR 4th Tuesday' },
        { block: 3, day: 'fri', session: 'am', nth: [1, 5], set: 'Peds OR', note: 'Peds OR 1st and 5th Friday' },
        // Block 3 Wed AM: Abendroth (Stadium) 3rd Wed; cover Peds clinic 1st Wed during ROP rounds
        { block: 3, day: 'wed', session: 'am', nth: [3], set: 'Stadium OR (Abendroth)', note: 'Abendroth 3rd Wednesday' },
        { block: 3, day: 'wed', session: 'am', nth: [1], set: 'Peds', note: 'Cover Peds clinic 1st Wed while the 2nd year is in ROP Rounds' },
        // Block 3 Thu PM: OR (often Cornea cases) 2nd, 4th, and 5th Thu
        { block: 3, day: 'thu', session: 'pm', nth: [2, 4, 5], set: 'OR', note: 'OR (often Cornea cases) 2nd, 4th, and 5th Thursday' },
        // Block 4: Oncology alternate Mon/Tue odd/even weeks (1st, 3rd, 5th Mon; 2nd, 4th Tue)
        { block: 4, day: 'mon', session: 'am', nth: [1, 3, 5], set: 'Oncology', note: 'Oncology 1st, 3rd, 5th Monday' },
        { block: 4, day: 'tue', session: 'am', nth: [2, 4], set: 'Oncology', note: 'Oncology 2nd, 4th Tuesday' },
        { block: 4, day: 'tue', session: 'am', nth: [4], note: 'Tumor Conference every 4th Tuesday at 6:45am' },
        { block: 4, day: 'thu', session: 'am', note: 'Med student teaching weekly 8:30–9:30am' },
        { block: 4, day: 'fri', session: 'am', note: 'Med student teaching weekly 8:30–9:30am' },
        // Block 6 Thu: Stadium OR (Marous) 3rd Thu Jan/Mar/May/Jul; Carrasco AM clinic 3rd Thu Dec/Feb/Apr/Jun; Bilyk clinic when not in OR
        { block: 6, day: 'thu', session: 'am', nth: [3], months: [1, 3, 5, 7], set: 'Stadium OR (Marous)', note: 'Stadium OR Marous AM/PM 3rd Thursday Jan/Mar/May/Jul' },
        { block: 6, day: 'thu', session: 'pm', nth: [3], months: [1, 3, 5, 7], set: 'Stadium OR (Marous)', note: 'Stadium OR Marous AM/PM 3rd Thursday Jan/Mar/May/Jul' },
        { block: 6, day: 'thu', session: 'am', nth: [3], months: [12, 2, 4, 6], set: 'Carrasco Clinic', note: 'Carrasco AM clinic 3rd Thursday Dec/Feb/Apr/Jun' },
        { block: 6, day: 'thu', session: 'am', note: 'Bilyk Clinic when not in OR' },
        { block: 6, day: 'thu', session: 'pm', note: 'Bilyk Clinic when not in OR' },
        { block: 6, day: 'thu', session: 'pm', note: 'May be Plastics clinic when there are no OR cases' }
      ],
      gridNotes: [
        'Blocks 2 & 5: Taskmaster',
        'Block 1: Benson if not seeing consults; Cooper clinic 1st Wednesday and 4th Tuesday AM',
        'Block 3: Peds OR 4th Tues and 1st and 5th Fri; Abendroth 3rd Wed (otherwise Peds OR, except covering Peds clinic 1st Wed during ROP Rounds); Thu PM OR (often Cornea cases) 2nd, 4th, and 5th Thu',
        'Block 4: Oncology alternates Mon/Tue odd/even weeks (1st, 3rd, 5th Mon; 2nd, 4th Tue); Tumor Conference 4th Tues 6:45am; med student teaching weekly 8:30–9:30am',
        'Block 6: Stadium OR Marous AM/PM 3rd Thursday Jan/Mar/May/Jul; Carrasco AM clinic 3rd Thursday Dec/Feb/Apr/Jun; Bilyk Clinic when not in OR'
      ]
    },

    pgy3: {
      key: 'pgy3',
      label: 'PGY-3 (Second Year)',
      short: 'PGY-3',
      residents: ['DeSimone', 'Camacho', 'Parekh', 'Cotton', 'Nahar', 'Williamson', 'Tang', 'Perez'],
      taskmasterBlocks: [],
      blockRanges: [
        { start: '2026-07-20', end: '2026-08-30', blocks: { DeSimone: 8, Camacho: 5, Parekh: 2, Cotton: 1, Nahar: 4, Williamson: 3, Tang: 7, Perez: 6 } },
        { start: '2026-08-31', end: '2026-10-11', blocks: { DeSimone: 1, Camacho: 6, Parekh: 3, Cotton: 2, Nahar: 5, Williamson: 4, Tang: 8, Perez: 7 } },
        { start: '2026-10-12', end: '2026-11-22', blocks: { DeSimone: 2, Camacho: 7, Parekh: 4, Cotton: 3, Nahar: 6, Williamson: 5, Tang: 1, Perez: 8 } },
        { start: '2026-11-23', end: '2027-01-17', blocks: { DeSimone: 3, Camacho: 8, Parekh: 5, Cotton: 4, Nahar: 7, Williamson: 6, Tang: 2, Perez: 1 } },
        { start: '2027-01-18', end: '2027-02-28', blocks: { DeSimone: 4, Camacho: 1, Parekh: 6, Cotton: 5, Nahar: 8, Williamson: 7, Tang: 3, Perez: 2 } },
        { start: '2027-03-01', end: '2027-04-11', blocks: { DeSimone: 5, Camacho: 2, Parekh: 7, Cotton: 6, Nahar: 1, Williamson: 8, Tang: 4, Perez: 3 } },
        { start: '2027-04-12', end: '2027-05-23', blocks: { DeSimone: 6, Camacho: 3, Parekh: 8, Cotton: 7, Nahar: 2, Williamson: 1, Tang: 5, Perez: 4 } },
        { start: '2027-05-24', end: '2027-06-30', blocks: { DeSimone: 7, Camacho: 4, Parekh: 1, Cotton: 8, Nahar: 3, Williamson: 2, Tang: 6, Perez: 5 } }
      ],
      grid: {
        1: {
          mon: { am: 'Jeff Consults', pm: 'Jeff Consults' },
          tue: { am: 'Jeff Consults', pm: 'Jeff Consults' },
          wed: { am: 'Jeff Consults', pm: 'Jeff Consults' },
          thu: { am: 'Jeff Consults', pm: 'Jeff Consults' },
          fri: { am: 'Jeff Consults', pm: 'Jeff Consults' }
        },
        2: {
          mon: { am: 'Peds', pm: 'Peds' },
          tue: { am: 'CPEC', pm: 'Peds' },
          wed: { am: 'Peds', pm: 'Peds' },
          thu: { am: 'Peds', pm: 'Peds' },
          fri: { am: 'Peds', pm: 'CPEC' }
        },
        3: {
          mon: { am: 'CPEC', pm: 'Cornea' },
          tue: { am: 'Wills OR', pm: 'Wills OR' },
          wed: { am: 'Private Cornea', pm: 'Cornea' },
          thu: { am: 'Cornea', pm: 'CPEC' },
          fri: { am: 'CPEC', pm: 'Cornea' }
        },
        4: {
          mon: { am: 'ER', pm: 'ER' },
          tue: { am: 'ER', pm: 'ER' },
          wed: { am: 'ER', pm: 'ER' },
          thu: { am: 'Cooper Clinic', pm: 'CPEC' },
          fri: { am: 'Cooper OR', pm: 'PT' }
        },
        5: {
          mon: { am: 'Glaucoma OR / Plastics OR', pm: 'Glaucoma' },
          tue: { am: 'Wills OR', pm: 'Glaucoma' },
          wed: { am: 'Private Glaucoma', pm: 'Plastics' },
          thu: { am: 'CPEC', pm: 'Glaucoma' },
          fri: { am: 'Glaucoma Lasers', pm: 'Plastics' }
        },
        6: {
          mon: { am: 'CPEC', pm: 'CPEC' },
          tue: { am: 'CPEC', pm: 'CPEC' },
          wed: { am: 'CPEC', pm: 'CPEC' },
          thu: { am: 'Surg 6', pm: 'Surg 6' },
          fri: { am: 'CPEC', pm: 'PT' }
        },
        7: {
          mon: { am: 'Day Float', pm: 'Day Float' },
          tue: { am: 'Day Float', pm: 'Day Float' },
          wed: { am: 'Day Float', pm: 'Day Float' },
          thu: { am: 'Day Float', pm: 'Day Float' },
          fri: { am: 'Day Float', pm: 'Day Float' }
        },
        8: {
          mon: { am: 'Retina Private', pm: 'Retina Private' },
          tue: { am: 'Uveitis', pm: 'Retina' },
          wed: { am: 'Neuro', pm: 'Retina' },
          thu: { am: 'ER', pm: 'ER' },
          fri: { am: 'ER', pm: 'ER' }
        }
      },
      overrides: [
        // Block 2: ROP Rounds 1st Wed (1st year covers Peds clinic); Peds OR 3rd Fri
        { block: 2, day: 'wed', session: 'am', nth: [1], set: 'ROP Rounds', note: 'ROP Rounds 1st Wednesday (then return to clinic so 1st year can go to Peds OR)' },
        { block: 2, day: 'fri', session: 'am', nth: [3], set: 'Peds OR', note: 'Peds OR 3rd Friday' },
        // Block 3: Tue Wills cataracts with the third year (Surg 5) at Stadium
        { block: 3, day: 'tue', session: 'am', note: 'Wills cataract cases with Third Year (Surg 5) at Stadium' },
        { block: 3, day: 'tue', session: 'pm', note: 'Wills cataract cases with Third Year (Surg 5) at Stadium' },
        // Block 5: Mon alternates Glaucoma OR / Plastics OR every other week
        { block: 5, day: 'mon', session: 'am', note: 'Alternate Glaucoma OR and Plastics OR every other week' },
        // Block 5: Tue Wills cataracts with the third year (Surg 1)
        { block: 5, day: 'tue', session: 'am', note: 'Wills cataract cases with Third Year (Surg 1)' },
        // Block 5: Plastics OR the 4th Wed
        { block: 5, day: 'wed', session: 'pm', nth: [4], set: 'Plastics OR', note: 'Plastics OR the 4th Wednesday' },
        // Block 6: Surg 6 role
        { block: 6, day: 'thu', session: 'am', note: 'Surg 6: shadow Surg 1/5 or Anhalt cases; otherwise backup for OR at Wills, JHN, or Gibbon + subspecialty cases' },
        { block: 6, day: 'thu', session: 'pm', note: 'Surg 6: shadow Surg 1/5 or Anhalt cases; otherwise backup for OR at Wills, JHN, or Gibbon + subspecialty cases' },
        // Block 6: Fri AM cataract evaluations and surgical post-op clinic
        { block: 6, day: 'fri', session: 'am', note: 'Cataract evaluations and surgical post-op clinic' }
      ],
      gridNotes: [
        'Block 2: ROP Rounds 1st Wed (then return to clinic so 1st year can go to Peds OR); Peds OR 3rd Fri',
        'Block 3: Tue = Wills cataract cases with Third Year (Surg 5) at Stadium',
        'Block 5: Mon alternates Glaucoma OR and Plastics OR every other week; Tue = Wills cataract cases with Third Year (Surg 1); Plastics OR the 4th Wed',
        'Block 6: Surg 6 shadows Surg 1/5 or Anhalt cases; otherwise backup for OR at Wills, JHN, or Gibbon + subspecialty cases; Fri AM = cataract evals and surgical post-op clinic'
      ]
    },

    pgy4: {
      key: 'pgy4',
      label: 'PGY-4 (Third Year)',
      short: 'PGY-4',
      residents: ['Bair', 'Aguwa', 'Samuel', 'Wibbelsman', 'Calotti', 'Djulbegovic', 'Cheng', 'Shields'],
      taskmasterBlocks: [],
      blockRanges: [
        { start: '2026-07-20', end: '2026-08-09', blocks: { Bair: 3, Aguwa: 6, Samuel: 4, Wibbelsman: 5, Calotti: 8, Djulbegovic: 2, Cheng: 1, Shields: 7 } },
        { start: '2026-08-10', end: '2026-08-30', blocks: { Bair: 4, Aguwa: 7, Samuel: 5, Wibbelsman: 6, Calotti: 1, Djulbegovic: 3, Cheng: 2, Shields: 8 } },
        { start: '2026-08-31', end: '2026-09-20', blocks: { Bair: 5, Aguwa: 8, Samuel: 6, Wibbelsman: 7, Calotti: 2, Djulbegovic: 4, Cheng: 3, Shields: 1 } },
        { start: '2026-09-21', end: '2026-10-11', blocks: { Bair: 6, Aguwa: 1, Samuel: 7, Wibbelsman: 8, Calotti: 3, Djulbegovic: 5, Cheng: 4, Shields: 2 } },
        { start: '2026-10-12', end: '2026-11-01', blocks: { Bair: 7, Aguwa: 2, Samuel: 8, Wibbelsman: 1, Calotti: 4, Djulbegovic: 6, Cheng: 5, Shields: 3 } },
        { start: '2026-11-02', end: '2026-11-22', blocks: { Bair: 8, Aguwa: 3, Samuel: 1, Wibbelsman: 2, Calotti: 5, Djulbegovic: 7, Cheng: 6, Shields: 4 } },
        { start: '2026-11-23', end: '2026-12-13', blocks: { Bair: 1, Aguwa: 4, Samuel: 2, Wibbelsman: 3, Calotti: 6, Djulbegovic: 8, Cheng: 7, Shields: 5 } },
        { start: '2026-12-14', end: '2027-01-17', blocks: { Bair: 2, Aguwa: 5, Samuel: 3, Wibbelsman: 4, Calotti: 7, Djulbegovic: 1, Cheng: 8, Shields: 6 } },
        { start: '2027-01-18', end: '2027-02-07', blocks: { Bair: 3, Aguwa: 6, Samuel: 4, Wibbelsman: 5, Calotti: 8, Djulbegovic: 2, Cheng: 1, Shields: 7 } },
        { start: '2027-02-08', end: '2027-02-28', blocks: { Bair: 4, Aguwa: 7, Samuel: 5, Wibbelsman: 6, Calotti: 1, Djulbegovic: 3, Cheng: 2, Shields: 8 } },
        { start: '2027-03-01', end: '2027-03-21', blocks: { Bair: 5, Aguwa: 8, Samuel: 6, Wibbelsman: 7, Calotti: 2, Djulbegovic: 4, Cheng: 3, Shields: 1 } },
        { start: '2027-03-22', end: '2027-04-11', blocks: { Bair: 6, Aguwa: 1, Samuel: 7, Wibbelsman: 8, Calotti: 3, Djulbegovic: 5, Cheng: 4, Shields: 2 } },
        { start: '2027-04-12', end: '2027-05-02', blocks: { Bair: 7, Aguwa: 2, Samuel: 8, Wibbelsman: 1, Calotti: 4, Djulbegovic: 6, Cheng: 5, Shields: 3 } },
        { start: '2027-05-03', end: '2027-05-23', blocks: { Bair: 8, Aguwa: 3, Samuel: 1, Wibbelsman: 2, Calotti: 5, Djulbegovic: 7, Cheng: 6, Shields: 4 } },
        { start: '2027-05-24', end: '2027-06-13', blocks: { Bair: 1, Aguwa: 4, Samuel: 2, Wibbelsman: 3, Calotti: 6, Djulbegovic: 8, Cheng: 7, Shields: 5 } },
        { start: '2027-06-14', end: '2027-06-30', blocks: { Bair: 2, Aguwa: 5, Samuel: 3, Wibbelsman: 4, Calotti: 7, Djulbegovic: 1, Cheng: 8, Shields: 6 } }
      ],
      grid: {
        1: {
          mon: { am: 'CPEC', pm: 'CPEC' },
          tue: { am: 'CPEC', pm: 'CPEC' },
          wed: { am: 'Surg 1', pm: 'Surg 1' },
          thu: { am: 'CPEC', pm: 'CPEC' },
          fri: { am: 'Surg 1', pm: 'Surg 1' }
        },
        2: {
          mon: { am: 'CPEC', pm: 'CPEC' },
          tue: { am: 'Surg 1', pm: 'Surg 1' },
          wed: { am: 'CPEC', pm: 'CPEC' },
          thu: { am: 'Surg 1', pm: 'Surg 1' },
          fri: { am: 'CPEC', pm: 'CPEC' }
        },
        3: {
          mon: { am: 'Surg 4', pm: 'Surg 4' },
          tue: { am: 'Surg 4', pm: 'Glaucoma' },
          wed: { am: 'Surg 4', pm: 'Glaucoma' },
          thu: { am: 'Surg 4', pm: 'Glaucoma' },
          fri: { am: 'Surg 4', pm: 'Surg 4' }
        },
        4: {
          mon: { am: 'Surg 1', pm: 'Surg 1' },
          tue: { am: 'CPEC', pm: 'CPEC' },
          wed: { am: 'Retina', pm: 'Retina' },
          thu: { am: 'Retina OR', pm: 'Retina OR' },
          fri: { am: 'Retina', pm: 'Retina' }
        },
        5: {
          mon: { am: 'Surg 2', pm: 'Surg 2' },
          tue: { am: 'Surg 2', pm: 'Surg 2' },
          wed: { am: 'Surg 5', pm: 'Surg 5' },
          thu: { am: 'Surg 5', pm: 'Surg 5' },
          fri: { am: 'CPEC', pm: 'CPEC' }
        },
        6: {
          mon: { am: 'Surg 3', pm: 'Cornea' },
          tue: { am: 'Surg 3', pm: 'Surg 3' },
          wed: { am: 'Surg 3', pm: 'Cornea' },
          thu: { am: 'Surg 3', pm: 'CPEC' },
          fri: { am: 'Surg 3', pm: 'Cornea' }
        },
        7: {
          mon: { am: 'Wills OR', pm: 'Wills OR' },
          tue: { am: 'Wills OR', pm: 'Wills OR' },
          wed: { am: 'CPEC', pm: 'CPEC' },
          thu: { am: 'Cooper Clinic', pm: 'Cooper Clinic' },
          fri: { am: 'Cooper OR', pm: 'Cooper OR' }
        },
        8: {
          mon: { am: 'Surg 5', pm: 'Surg 5' },
          tue: { am: 'Surg 5', pm: 'Surg 5' },
          wed: { am: 'Surg 2', pm: 'Surg 2' },
          thu: { am: 'Surg 2', pm: 'Surg 2' },
          fri: { am: 'Surg 2', pm: 'Surg 2' }
        }
      },
      overrides: [
        // Block 4: Tabas cataracts 3rd Wednesday; Dunn cataracts every 4th Friday
        { block: 4, day: 'wed', session: 'am', nth: [3], set: 'Tabas Cataracts', note: 'Tabas cataracts 3rd Wednesday' },
        { block: 4, day: 'wed', session: 'pm', nth: [3], set: 'Tabas Cataracts', note: 'Tabas cataracts 3rd Wednesday' },
        { block: 4, day: 'fri', session: 'am', nth: [4], set: 'Dunn Cataracts', note: 'Dunn cataracts every 4th Friday' },
        { block: 4, day: 'fri', session: 'pm', nth: [4], set: 'Dunn Cataracts', note: 'Dunn cataracts every 4th Friday' },
        // Block 5: Tue — if no cases, then Oncology 2nd and 4th
        { block: 5, day: 'tue', session: 'am', nth: [2, 4], note: 'If no cases, then Oncology (2nd and 4th Tue)' },
        { block: 5, day: 'tue', session: 'pm', nth: [2, 4], note: 'If no cases, then Oncology (2nd and 4th Tue)' },
        // Block 7: Markovitz Cherry Hill PM cases 4th Tuesday
        { block: 7, day: 'tue', session: 'pm', nth: [4], note: 'Markovitz Cherry Hill PM cases 4th Tuesday' },
        // Block 8: Thu — if no cases, then observe refractive
        { block: 8, day: 'thu', session: 'am', note: 'If no cases, then observe refractive' },
        { block: 8, day: 'thu', session: 'pm', note: 'If no cases, then observe refractive' }
      ],
      gridNotes: [
        'Surg 1 and 5 = Cataracts',
        'Surg 2 = Trauma / Cataracts; cover Cornea/Glaucoma if Surg 3/4 has PM cases',
        'Surg 3 = Cornea / Trauma needing graft / Peds',
        'Surg 4 = Glaucoma / Peds / Plastics',
        'Block 4: Tabas cataracts 3rd Wednesday; Dunn cataracts every 4th Friday',
        'Block 5: Tue — if no cases, then Oncology 2nd and 4th',
        'Block 7: Markovitz Cherry Hill PM cases 4th Tuesday',
        'Block 8: Thu — if no cases, then observe refractive'
      ]
    }
  },

  surgRoleMeta: {
    'Surg 1': 'Cataracts',
    'Surg 2': 'Trauma / Cataracts; covers Cornea/Glaucoma clinic if Surg 3/4 has PM cases. Surg 2 is the boss.',
    'Surg 3': 'Cornea / Trauma needing graft / Peds',
    'Surg 4': 'Glaucoma / Peds / Plastics',
    'Surg 5': 'Cataracts',
    'Surg 6': 'PGY-3 (block 6, Thu): shadow Surg 1/5 or Anhalt cases; otherwise OR backup at Wills, JHN, or Gibbon'
  },

  // Case-assignment hierarchy from the "How to Surgical Schedule" doc.
  // Chain entries are either Surg roles, or special tokens:
  //   PEDS_OR_JUNIOR   = 1st or 2nd year on Peds OR that day
  //   PLASTICS_OR_PGY2 = 1st year on Plastics OR that day
  //   FREE_JUNIOR      = free/willing 1st or 2nd year at the discretion of Surg 2
  //   COOPER           = Cooper Consults resident
  //   WILLS_OR         = resident on Wills OR block
  //   RETINA           = resident on Retina block
  hierarchy: {
    scheduledCataract: { label: 'Scheduled cataracts', chain: ['Surg 1', 'Surg 5', 'WILLS_OR'], note: 'Assign per the surgical block schedule on the lounge wall; check NextGen and Cerner to delineate service vs private. PGY-3s join Wills OR cataracts Tue/Thu.' },
    addOnCataract: { label: 'Overflow / add-on cataracts', chain: ['Surg 2', 'Surg 1', 'Surg 5', 'WILLS_OR'], note: 'Surg 2 is the first to get overflow cataracts if available.' },
    scheduledCornea: { label: 'Scheduled cornea', chain: ['Surg 3'], note: 'Surg 3 should know scheduled cases and reach out to the operating attending beforehand.' },
    scheduledGlaucoma: { label: 'Scheduled glaucoma', chain: ['Surg 4'], note: 'Surg 4 should know scheduled cases and reach out to the operating attending beforehand.' },
    addOnCornea: { label: 'Add-on cornea (incl. trauma requiring tissue)', chain: ['Surg 3', 'Surg 2'], note: 'Emergent PKP / ruptures needing new corneal tissue go to cornea; Surg 2 next up if the subspecialty resident is not available.' },
    addOnGlaucoma: { label: 'Add-on glaucoma', chain: ['Surg 4', 'Surg 2'], note: 'Tubes go to glaucoma; Surg 2 next up if the subspecialty resident is not available.' },
    scheduledPlastics: { label: 'Scheduled plastics (incl. Gibbon/JHN)', chain: ['PLASTICS_OR_PGY2', 'FREE_JUNIOR', 'Surg 4', 'Surg 2'], note: 'Run the master daily schedule for JHN/Gibbon and specifically check for combo cases with Wills attendings.' },
    peds: { label: 'Peds', chain: ['PEDS_OR_JUNIOR', 'FREE_JUNIOR', 'Surg 4', 'Surg 3'], note: 'Strabismus requires a resident — juniors on Peds get priority; schedule a senior backup if cases may run into evening clinic. Non-strab peds cases do not require coverage but attendings prefer one. If short, check with the Peds fellow.' },
    traumaPlasticsAddOn: { label: 'Trauma and plastics add-ons', chain: ['PLASTICS_OR_JUNIOR', 'Surg 2', 'Surg 3', 'Surg 4', 'COOPER', 'Surg 1', 'Surg 5'], note: 'The junior on Plastics OR takes only TABs and add-on outpatient plastics; trauma goes to Surg 2 first (unless corneal tissue is needed — then cornea).' },
    jhnAddOn: { label: 'Add-ons at JHN/Gibbon/Jeff Surgicenter', chain: ['Surg 2', 'Surg 3', 'Surg 4', 'COOPER', 'Surg 1', 'Surg 5'], note: 'Add-on cases at JHN/Gibbon/JSC go to Surg 2 first if available.' },
    remaining: { label: 'Remaining cases (chronological order)', chain: ['Surg 2', 'Surg 3', 'Surg 4', 'COOPER', 'Surg 1', 'Surg 5'] },
    clinicCoverage: { label: 'Clinic coverage', chain: ['Surg 2', 'Surg 3', 'Surg 4', 'COOPER', 'Surg 1', 'Surg 5', 'WILLS_OR', 'RETINA'], note: 'The PM clinic manager is helpful with clinic assignments.' }
  },

  schedulingNotes: [
    'Surg 2 is the boss. Give them some grace when things get busy.',
    'Surg 2 is first for trauma (not requiring corneal tissue).',
    'Add-on cases at Wills go to the resident on the subspecialty block if available (tubes → glaucoma; emergent PKP / ruptures requiring new corneal tissue → cornea); Surg 2 next up if the subspecialty resident is not available.',
    'Add-on cases at JHN/Gibbon/Jeff Surgicenter go to Surg 2 first if available.',
    'Surg 2 is the first to get overflow cataracts if available.',
    'Strabismus cases require a resident — 1st and 2nd years on Peds get priority, but schedule a senior backup if cases may run over into evening clinic.',
    'Other peds cases (non-strab) do not require resident coverage, but attendings prefer to have one.',
    'Ayres pterygiums require a resident.',
    'JP Dunn cases are service at the START of the year (first and fourth Fridays).',
    'Enucleations / eviscerations / TABs / lid procedures can go to free 1st and 2nd years.',
    'If the patient has not rolled back to the OR by 4:30, it can be passed to the call person.',
    'For urgent call-outs or coverage issues (especially during MYF, AAO, etc.), involve the chiefs.'
  ],

  postOpNotes: [
    'The operating third year is responsible for cataract post-ops until POM1.',
    'Subspecialty plastics, cornea, and glaucoma post-ops: about 1 week if uncomplicated — may be attending dependent.',
    'Keep a tight schedule of your post-ops — a common point of contention with clinic managers, and patients sometimes show up at random times/days/weeks.'
  ],

  caseSourcesNote: 'Which cases am I actually doing? Compare all three and take the overlap: the NextGen "CPEC surgery" filter (probably the most accurate, but sometimes not), the CPEC surgical block schedule on the lounge wall (the key — NextGen occasionally lists cases under the wrong resident), and the packets (mildly accurate).',

  cataractPrep: [
    'Do lens calcs and send to the attending 1 week before surgery (consider the NextGen surgical sign-up template).',
    'Put the lens order request in Cerner at least 3 days before the surgical date.',
    'Call patients before surgery — especially monovision, near aim, missing testing, or high-maintenance (a Google Voice number helps).',
    'Prepare copies of post-op drop instructions (for Stadium and Cherry Hill).',
    'Make sure the POD1 visit is scheduled at a time you can actually see them.',
    'Bring your hard drive and packets on the day of surgery (packets live in Kris Davis’ office in CPEC; the cover page is the lens order sheet).',
    'Cherry Hill (Markovitz): Loida emails packets with the IOL Master; do calcs from ModMed (first-eye “green sheet” under attachments); send calcs to Markovitz; fax the lens selection sheet to Cherry Hill.',
    'Cooper (Markovitz): send calcs to Markovitz; no fax needed — lenses are sent to Cooper in advance; bring any torics from Wills (multiple options if between lenses).',
    'Stadium: same prep as other Wills cases; fax lens selection sheets at least 3 days ahead — longer for non-standard lenses (high torics, unusual powers).'
  ],

  quote: '“The Surg schedule makes itself, Surg 2 just enforces it.” — Pat Rapuano',

  // Attending clinic patterns (2nd-year page): shown as day-context info.
  specialClinics: [
    { label: 'Bilyk Clinic', day: 'tue', session: 'pm', nth: [1, 2, 4] },
    { label: 'Bilyk Clinic', day: 'wed', session: 'pm', nth: [1, 3, 4] },
    { label: 'Bilyk Clinic', day: 'thu', session: 'pm', nth: [4] },
    { label: 'Bilyk Clinic', day: 'fri', session: 'pm', nth: [3] },
    { label: 'Pemphigoid Clinic', day: 'fri', session: 'all', nth: [3] },
    { label: 'Wasserman Clinic', day: 'thu', session: 'pm', nth: [3] },
    { label: 'Schnall Clinic', day: 'fri', session: 'am', nth: [2, 4] }
  ]
};

if (typeof window !== 'undefined') window.SCHED_DATA = SCHED_DATA;
if (typeof module !== 'undefined' && module.exports) module.exports = SCHED_DATA;
