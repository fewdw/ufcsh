# Weight misses attributed to a namesake — October 5, 2026

Alex Pereira showed "Missed weight · 174 lb" for his light heavyweight bout at
UFC 291. The event article's sentence was about Michel Pereira, whose welterweight
bout on that card was scrapped; a bare surname was matched to the card's fighter.

The parser now follows the full name used in the same paragraph, accepting the
article's spelling of a card fighter's own name (Phil/Philip, middle names).
Compared against all 791 archived event articles, six events change, each a
false attribution removed and no stated miss lost:

- UFC 291: Alex Pereira (Michel Pereira's miss)
- UFC Fight Night: Almeida vs. Lewis: Gabriel Bonfim (Ismael Bonfim's miss)
- UFC 305: Luana Santos (Jesús Santos Aguilar's miss)
- UFC 244: Brad Tavares; UFC 200: Jim Miller and Takanori Gomi; UFC 85: Matt Hughes
  (weights carried over from another paragraph's fighter)

Startup queues one weigh-in re-read for completed cards older than 30 days that
have a stored miss. The Bugs board lists any miss recorded at or under its
division limit, with a re-read action; bouts that moved up a division after a
miss stay listed there as known exceptions.
