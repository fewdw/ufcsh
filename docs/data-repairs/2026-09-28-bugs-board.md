# Bugs board repairs — September 28, 2026

Source fixes in the `bug/bugs-board-sep28` release, then one-off repairs on production. A pre-repair copy of the database is at `/data/backups/bugs-board-repair-ufc-20260928.db`.

## What was wrong

- **Event articles from another city.** Six cards held another event's Wikipedia infobox: the Belfast card of November 19, 2016 had São Paulo's (same night), São Paulo's of May 31, 2014 had Berlin's, and four 2012 cards (UFC 149, Johnson vs. McCall, Korean Zombie vs. Poirier, Sanchez vs. Ellenberger) had UFC on Fox 2's United Center from the "2012 in UFC" summary. Venue, attendance, gate and weigh-in misses came from the wrong card. An article is now accepted only when its city shares a city, state or country with the card's location, and the "Venue in a different city" check also compares the article's city.
- **`&nbsp;` in venue names.** Eight London cards showed "The O2&nbsp;Arena".
- **Renamed arenas.** 18 former names (MGM Grand Arena, Arrowhead Pond, ARCO Arena, MEN Arena, …) now join the ufc.com venue they became, same city only.
- **Split odds boards.** BestFightOdds put UFC 332's prelims on a second board ("UFC for October 3") missing from its sitemap, so eight bouts had no props. Front-page boards are now added to the event index.
- **Verified histories stuck after a debut.** A verified Sherdog page whose record drifted from UFCStats by the debut failed re-verification and kept its pre-debut history. A page already verified now stays verified while it still reconciles every UFC bout.
- **Duplicate names.** The check counted UFCStats directory entries with no bout, which have no page; 44 of 45 were a signee and that hidden entry.
- **Officials.** Michael Bell and Douglas Crosby confirmed as Mike Bell and Doug Crosby (listed both ways on the same nights).

## Left as they are

Source-side: BestFightOdds has no lines yet for the October 10/17 cards and never listed UFC 318's undercard or UFC 289's Oliveira vs. Dariush; ufc.com lists only Allen vs. Duncan for October 10 and has silhouettes for the debutants missing photos; UFCStats has no height or reach for them; Verdict lists only the main card for the events still missing community cards.
