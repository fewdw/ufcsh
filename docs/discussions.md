# Fight discussions

Every matchup has a **Discussion** tab. Anyone can read it; signed-in fans can
comment, reply, vote, report and block.

## Threads

- A comment (level 1), a reply to it (level 2), and a reply to that (level 3).
  Nothing deeper is stored. Replying to a level-3 comment posts beside it,
  prefilled with `@username`.
- Sorts: **Top** (Wilson lower bound of up/down votes, so one early upvote
  doesn't outrank forty), **New** and **Old**. Twenty threads a page, ten
  replies inline per comment; "N more replies" loads the whole thread.
- Every comment has a permalink, `/fights/:id?tab=discussion&comment=:commentId`,
  which opens its thread with that comment highlighted.
- Beside each name is the author's prediction for the bout, if they made one:
  a pill in their fighter's corner colour (blue for the first-listed fighter,
  red for the second) reading `Rosas`, `Rosas DEC` or `Rosas KO/TKO R1`.
- Comments are plain text. Nothing is rendered as HTML or Markdown and links are
  not clickable, which removes most of the reason to spam them.
- Authors can edit for one hour (marked "edited") and delete at any time. A
  deleted comment with replies stays as a "Deleted" placeholder so the replies
  keep their context; without replies it disappears.

## Moderation policy

Light-touch: no word is banned by itself, including profanity and slurs. What
gets refused is the *shape* of abuse, with a message saying why
(`server/src/moderation.ts`):

| Rule | Limit |
| --- | --- |
| Length | 2,000 characters, 40 lines |
| Mostly swearing | ≥ 3 profane words making up over half the comment |
| Slur spam | 4 or more slurs in one comment |
| Shouting | ≥ 24 letters and over 80% capitals |
| Self-harm incitement | "kys", "kill yourself" and variants, including spaced-out letters |
| Personal info | email addresses and phone numbers |
| Links | at most 2; none from accounts under a day old |
| Gibberish | any "word" longer than 60 characters |
| Invisible text | zero-width and bidi-override characters stripped; stacked diacritics trimmed |
| Floods | runs of one character shortened to six ("GOOOOOOOO" → "GOOOOOO") |

## Spam and rate limits

Per account, enforced from the database so a restart doesn't reset them:

- 30 comments an hour (6 for accounts under a day old), 200 a day.
- 8 comments per fight per 10 minutes.
- The same text twice in one fight within a day is refused. The same text in
  several fights within an hour is refused. Text of 30+ characters already
  posted by two other accounts in the last hour is refused as a copy-paste wave.

Plus in-memory bursts: 3 comments per 15 seconds per account, 20 per 10 minutes
per IP, votes at one a second after a burst of 30, and 10 reports an hour (50 a day).

## Community tools

- **Votes.** Comments at −5 or below start collapsed. You can't vote on your
  own comment.
- **Report.** One report per person per comment, with a reason (spam,
  harassment, hate, threats, trolling, sexual, personal info, other) and an
  optional note. The report keeps a copy of the text, so editing or deleting
  afterwards doesn't hide it from moderators.
- **Auto-hold.** Once reports from **three accounts older than a day** are
  open on a comment, it is hidden ("Hidden while a moderator reviews it") until
  an administrator keeps or removes it. The author still sees their own text.
  New accounts' reports are recorded but don't count toward the hold, so a
  handful of throwaway accounts can't bury a comment.
- **Block.** Collapses someone's comments for you and stops them replying to
  yours. Blocked people are listed, with Unblock, on your profile's Comments tab.

## Administration

`/admin` → **Comments**:

- **Reported**: most-reported first, with reasons, notes, reporters, and the
  text as it was when reported. **Keep** closes the reports and lifts a hold;
  **Remove** takes the comment down (shown as "Removed by a moderator").
- **Recent**: the newest 200 comments of any kind, for proactive review.
- **Removed**: what has been taken down, by whom and why; **Restore** undoes it.
- **Muted**: every muted account; **Unmute** lifts it.

From any comment you can **mute its author** for 1 hour, 24 hours, 7 days,
30 days or permanently, optionally removing everything they have posted (for
spam accounts). Muted accounts can still read, report and delete their own
comments. Every action records the administrator's email.

## Profiles

Each profile has a **Comments** tab listing the fan's comments newest first.
It is **hidden from others by default**. The owner always sees it, and can
untick **Hide comments from my profile** in the profile header to make it
public. Comments stay on each fight either way.

## API

```
GET    /api/fights/:id/comments?sort=top|new|old&offset=   page of threads (token optional)
POST   /api/fights/:id/comments          { body, parentId? }
GET    /api/comments/:id/thread?sort=     the whole thread containing a comment
PATCH  /api/comments/:id                 { body }            edit (1 hour)
DELETE /api/comments/:id                                      delete your own
PUT    /api/comments/:id/vote            { value: -1|0|1 }
POST   /api/comments/:id/report          { reason, note? }
GET    /api/comments/blocks                                   your blocks
PUT    /api/comments/blocks/:handle       DELETE to unblock
GET    /api/profiles/:handle/comments?offset=                 403 if private (owner excepted)
PUT    /api/profiles/mine                { commentsPublic: boolean }

GET    /api/admin/comments?view=reported|recent|removed
PUT    /api/admin/comments/:id           { action: dismiss|remove|restore, reason? }
GET    /api/admin/commenters                                  muted accounts
PUT    /api/admin/commenters/:handle      { hours: -1 (permanent) | 0 (lift) | n, purge?, reason? }
```

Every discussion response is `private, no-store`. Writes need a Clerk bearer
token from an allowed origin, like the rest of the fan features. Comments live
in `scoring.db` beside scorecards, so the existing backups cover them.
