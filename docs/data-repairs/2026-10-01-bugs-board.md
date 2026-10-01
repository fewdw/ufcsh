# Bugs board repairs — October 1, 2026

Measured on a production snapshot: 44 open items (1 must, 43 minor) → 15 minor.

- **Past closing lines.** BestFightOdds never listed UFC 318's undercard or UFC 289's Oliveira vs. Dariush. FightOdds.io keeps each completed board's last pre-fight quotes, matched by UFCStats id; a daily sweep (`syncPastFightOdds`) fills completed bouts with no line, and "Re-fetch odds" falls back to it. 11 of 12 filled; UFC 81's Almeida vs. Yundt isn't on either source.
- **Gabriel Lorenco.** Sherdog spells him Lourenco. A booked opponent's verified page may now name the fighter one letter differently; the history still has to verify.
- **Height and reach.** UFCStats had none for several debutants; ufc.com's athlete page (already read twice a day for roster status) fills blanks. UFCStats values still win, and a blank on UFCStats no longer erases them.
- **Grading.** A card no source has priced at all stays OK until fight week (Oct 17 card: no board on either source). An upcoming event read in the last day with no bouts on UFCStats, more than three weeks out, is OK (UFC 335).

## Left as they are

Three Oct 10 bouts no book has posted yet; McGhee vs. Romero has no per-round props; Brandon Royval's near-ranked opponents are all recent rematches; stance is missing on UFCStats for three fighters; ufc.com has no photo yet for Mahjoub, Szabova or Perez. Whitehead, Armand and Soldic's photos went up today and the image retry will pick them up.
