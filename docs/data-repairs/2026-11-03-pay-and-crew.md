# Pay names and the UFC Fight Night 293 crew

Reviewed on November 3, 2026, against public event reports and a private copy
of the development archive. No production database was changed.

## Pay parsing

The production report contained 27 unread bonus rows across 26 cards because
published names differed from UFCStats names, or a Korean given name was
joined in UFCStats but hyphenated in the event article. The other parser error
was the literal "None" in an unawarded submission-bonus row.

The matching change keeps the family-name boundary and compares the given
name with or without spaces, in either family-name order. Existing ambiguity
checks remain: equally good corners are rejected. The existing two-character
typo tolerance now also checks reviewed full-name aliases, so the event
article spelling "Antonio Rogerio Nogueria" can resolve to Rogerio Nogueira
without matching his brother Antonio Rodrigo Nogueira.

Reviewed identity evidence includes:

- [UFC: Kevin Souza](https://www.ufc.com/news/kevin-souza-he-knocks-people-out)
  explicitly says his first name is Edimilson and he goes by Kevin.
- [Daniel Lacerda interview](https://www.sherdog.com/news/articles/12-Questions-for-Daniel-Lacerda-182520/amp)
  gives his full name as Daniel da Silva Lacerda.
- [UFC: Mirko Cro Cop](https://www.ufc.com/news/cro-cop-got-his-vengeance-krakow)
  names Mirko "Cro Cop" Filipovic and his Gonzaga rematch.
- [UFC: Bia Mesquita](https://www.ufc.com/index.php/news/homefield-advantage-oliveira-brazilians-ufc-rio)
  identifies Beatriz "Bia" Mesquita and her Irina Alekseeva debut.
- [Nevada commission, March 1, 2025](https://boxing.nv.gov/uploadedFiles/boxingnvgov/content/results/2025_Results/03-01-25MMA_REDACTED.pdf)
  identifies Jose "Chepe" E. Mariscal.
- [Florida commission, October 5, 2018](https://www2.myfloridalicense.com/pro/sbc/documents/10-05-2018-Fight-Night-Results-w-out-med.pdf)
  identifies William "Billy" Quarantillo.
- [UFC: Michelle Waterson-Gomez](https://www.ufc.com/athlete/michelle-waterson?language_content_entity=en)
  records her earlier bouts under Waterson, including the Hill and VanZant wins.
- [Joseph Kropschot report](https://www.sherdog.com/news/news/Joseph-Kropschot-on-DWCS-graphic-armbar-injury-I-cannot-believe-he-didnt-tap-202320)
  uses Joseph in the report and embeds the UFC post naming Joe Kropschot.
- [Wesley Schultz report](https://cagesidepress.com/2026/02/28/ufc-mexico-city-damian-pinas-makes-short-work-of-wesley-schultz/)
  uses Wesley in its headline and prose, and Wes in the official Pinas result.
  [Sherdog](https://www.sherdog.com/news/news/Try-and-try-again-How-Wesley-Schultz-managed-to-pull-off-the-UFC-Perth-win-201058)
  also embeds a UFCNews post naming Wes within a report naming Wesley.

The remaining reviewed source names are the fighters recorded on the same
cards and in their public biographies: Joseph Duffy / Joe Duffy, Patrick
Holohan / Paddy Holohan, Ulka Sasaki / Yuta Sasaki, Jon Koppenhaver / War Machine,
Alexey Oleynik and Oleksiy Oliynyk / Aleksei Oleinik, Hayisaer Maheshate /
Maheshate, Sharabutdin Magomedov / Shara Magomedov, Polo Reyes / Marco Polo
Reyes, Nicholas Price / Niko Price, and Rayanne Amanda / Rayanne dos Santos.
The full card and opponent identities were checked before adding these aliases.
Hunter Carlyle was left unlinked because no independent identity evidence
was found; the report spelling alone was insufficient.

Replaying the current, date-validated Wikipedia articles for the 26 affected
cards on the fresh development archive reduced its unread bonus rows from
27 to zero and cards with stored pay issues from 83 to 57. It updated bonuses
on 25 bouts and added 25 bonus entries. Every stored purse was compared before
and after and remained identical. This replay refreshed only Wikipedia bonus
evidence; it did not resolve genuine salary-source disagreements or infer
malformed amounts. The production report has different archive totals, so
these are development-copy verification results.

A fingerprint of the aliases and parser revision queues cards with existing
pay issues once for the ordinary bounded background read. Their old pay stays
stored until the re-read succeeds. Clean cards and unfinished events are not
queued by this change.

## Crew

[MMA Junkie via Yahoo, November 3](https://sports.yahoo.com/articles/ufc-fight-night-293-broadcast-135029065.html)
explicitly confirms Brendan Fitzgerald on play-by-play, Daniel Cormier and
Dominick Cruz on color, Bruce Buffer announcing, McKenzie Pavacich reporting,
and Chris Weidman, Rashad Evans and Michael Chiesa as desk analysts.

Its host sentence literally says "XX serves as desk anchor and host". The
reviewed record retains the five supported core roles and leaves Desk host
unknown. The card therefore correctly remains a must-fix crew item until a
source actually names the host; no usual lineup was substituted.

## Verification

`DATA_DIR=<private archive copy> ./tools/heavy.sh node --test --test-concurrency=1 server/src/scrape/payouts.test.ts server/src/fight-pay.test.ts server/src/event-crew.test.ts`

All 36 tests passed. They cover Korean ordering, ambiguous identities, alias
typos and the Nogueira brothers, explicit unawarded bonuses, source amounts,
reviewed real archive fighters, historical queueing, and the unpublished host.
