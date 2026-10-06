/** FightOdds.io answers only the exact query texts its own web app sends
 *  (anything else: HTTP 403 "Unknown query"), so these are copied verbatim from
 *  the app bundle (fightodds.io/app.*.js, each Relay `text:"query Name..."`).
 *  Don't reformat them. If FightOdds rebuilds its app and a read fails with
 *  "Unknown query", copy the new text of the same operation. */

export const EventsPromotionQuery = `query EventsPromotionQuery(
  $promotionSlug: String
  $dateLt: Date
  $dateGte: Date
  $after: String
  $first: Int
  $orderBy: String
) {
  promotion: promotionBySlug(slug: $promotionSlug) {
    ...EventsPromotionTabPanel_promotion_34GGrn
    id
  }
}

fragment EventCardList_events on EventNodeConnection {
  edges {
    node {
      id
      ...EventCard_event
    }
  }
}

fragment EventCard_event on EventNode {
  id
  name
  pk
  slug
  date
  venue
  city
  promotion {
    slug
    shortName
    id
  }
  ...EventPoster_event
}

fragment EventPoster_event on EventNode {
  name
  poster
  posterWide
  promotion {
    shortName
    logo
    id
  }
}

fragment EventsPromotionTabPanel_promotion_34GGrn on PromotionNode {
  ...PromotionEventCardListInfiniteScroll_promotion_34GGrn
}

fragment PromotionEventCardListInfiniteScroll_promotion_34GGrn on PromotionNode {
  events(first: $first, after: $after, date_Gte: $dateGte, date_Lt: $dateLt, orderBy: $orderBy) {
    ...EventCardList_events
    edges {
      node {
        id
        __typename
      }
      cursor
    }
    pageInfo {
      hasNextPage
      endCursor
    }
  }
}
`;

export const CappingTableQrQuery = `query CappingTableQrQuery(
  $eventPk: Int
) {
  eventOffers: eventOfferTable(pk: $eventPk, allFights: true) {
    ...CappingTable_eventOffers
    id
  }
  sportsbooks: allSportsbooks(hasOdds: true) {
    ...CappingTable_sportsbooks
  }
}

fragment ButtonNotePopover_note on NoteNode {
  note
  ...PopoverNote_note
}

fragment CappingTable_eventOffers on EventOfferTableNode {
  name
  fightOffers {
    edges {
      node {
        fight {
          id
          slug
          isCancelled
          fighter1 {
            id
            pk
            slug
            wikipediaUrl
            instagram
            fightmetricUrl
            tapologyUrl
            sherdogUrl
            firstName
            lastName
            ...FighterFullName_fighter
            ...FighterFlag_fighter
            ...FighterAge_fighter
            ...FighterRecord_fighter
            ...FighterStance_fighter
            ...FighterFightingStyle_fighter
            ...FighterReach_fighter
            ...FighterHeight_fighter
            ...FighterWeight_fighter
            ...FighterCamp_fighter
            ...FighterSapm_fighter
            ...FighterSlpm_fighter
            ...FighterStrAcc_fighter
            ...FighterStrDef_fighter
            ...FighterSubAvg_fighter
            ...FighterTdAcc_fighter
            ...FighterTdAvg_fighter
            ...FighterTdDef_fighter
            ufcDebut
            koLoss
            weightClassChange
            myNotes {
              edges {
                node {
                  ...ButtonNotePopover_note
                  id
                }
              }
            }
            currentCamp {
              name
              id
              myNotes {
                edges {
                  node {
                    ...ButtonNotePopover_note
                    id
                  }
                }
              }
            }
          }
          fighter2 {
            id
            pk
            slug
            wikipediaUrl
            instagram
            fightmetricUrl
            tapologyUrl
            sherdogUrl
            firstName
            lastName
            ...FighterFullName_fighter
            ...FighterFlag_fighter
            ...FighterAge_fighter
            ...FighterRecord_fighter
            ...FighterStance_fighter
            ...FighterFightingStyle_fighter
            ...FighterReach_fighter
            ...FighterHeight_fighter
            ...FighterWeight_fighter
            ...FighterCamp_fighter
            ...FighterSapm_fighter
            ...FighterSlpm_fighter
            ...FighterStrAcc_fighter
            ...FighterStrDef_fighter
            ...FighterSubAvg_fighter
            ...FighterTdAcc_fighter
            ...FighterTdAvg_fighter
            ...FighterTdDef_fighter
            ufcDebut
            koLoss
            weightClassChange
            myNotes {
              edges {
                node {
                  type
                  ...ButtonNotePopover_note
                  id
                }
              }
            }
            currentCamp {
              name
              myNotes {
                edges {
                  node {
                    ...ButtonNotePopover_note
                    id
                  }
                }
              }
              id
            }
          }
          weightClass {
            weightClass
            id
          }
          myNotes {
            edges {
              node {
                type
                ...ButtonNotePopover_note
                id
              }
            }
          }
        }
        bestOdds1
        bestOdds2
        straightOffers {
          edges {
            node {
              sportsbook {
                id
              }
              outcome1 {
                odds
                ...OddsWithArrowButton_outcome
                id
              }
              outcome2 {
                odds
                ...OddsWithArrowButton_outcome
                id
              }
              id
            }
          }
        }
        id
      }
    }
  }
}

fragment CappingTable_sportsbooks on SportsbookNodeConnection {
  edges {
    node {
      id
      shortName
      fullName
      slug
    }
  }
}

fragment FighterAge_fighter on FighterNode {
  birthDate
  age
}

fragment FighterCamp_fighter on FighterNode {
  camps {
    edges {
      node {
        name
        id
      }
    }
  }
}

fragment FighterFightingStyle_fighter on FighterNode {
  fightingStyle
}

fragment FighterFlag_fighter on FighterNode {
  nationality
}

fragment FighterFullName_fighter on FighterNode {
  firstName
  lastName
}

fragment FighterHeight_fighter on FighterNode {
  height
}

fragment FighterReach_fighter on FighterNode {
  reach
}

fragment FighterRecord_fighter on FighterNode {
  koWins
  subWins
  decWins
  dqWins
  koLosses
  subLosses
  decLosses
  dqLosses
  draws
}

fragment FighterSapm_fighter on FighterNode {
  sapm
}

fragment FighterSlpm_fighter on FighterNode {
  slpm
}

fragment FighterStance_fighter on FighterNode {
  stance
}

fragment FighterStrAcc_fighter on FighterNode {
  strAcc
}

fragment FighterStrDef_fighter on FighterNode {
  strDef
}

fragment FighterSubAvg_fighter on FighterNode {
  subAvg
}

fragment FighterTdAcc_fighter on FighterNode {
  tdAcc
}

fragment FighterTdAvg_fighter on FighterNode {
  tdAvg
}

fragment FighterTdDef_fighter on FighterNode {
  tdDef
}

fragment FighterWeight_fighter on FighterNode {
  weight
}

fragment Note_note on NoteNode {
  id
  note
}

fragment OddsWithArrowButton_outcome on OutcomeNode {
  id
  ...OddsWithArrow_outcome
}

fragment OddsWithArrow_outcome on OutcomeNode {
  odds
  oddsPrev
}

fragment PopoverNote_note on NoteNode {
  ...Note_note
}
`;

export const EventOfferTableQrQuery = `query EventOfferTableQrQuery(
  $eventPk: Int!
  $isCancelled: Boolean
) {
  sportsbooks: allSportsbooks(hasOdds: true) {
    ...EventOfferTable_sportsbooks
  }
  eventOfferTable(pk: $eventPk, isCancelled: $isCancelled) {
    slug
    pk
    name
    ...EventOfferTable_eventOfferTable
    id
  }
}

fragment EventOfferTable_eventOfferTable on EventOfferTableNode {
  name
  pk
  fightOffers {
    edges {
      node {
        id
        fighter1 {
          firstName
          lastName
          slug
          id
        }
        fighter2 {
          firstName
          lastName
          slug
          id
        }
        bestOdds1
        bestOdds2
        slug
        propCount
        isCancelled
        straightOffers {
          edges {
            node {
              sportsbook {
                id
                shortName
                slug
              }
              outcome1 {
                id
                odds
                ...OddsWithArrowButton_outcome
              }
              outcome2 {
                id
                odds
                ...OddsWithArrowButton_outcome
              }
              id
            }
          }
        }
      }
    }
  }
}

fragment EventOfferTable_sportsbooks on SportsbookNodeConnection {
  edges {
    node {
      id
      shortName
      slug
    }
  }
}

fragment OddsWithArrowButton_outcome on OutcomeNode {
  id
  ...OddsWithArrow_outcome
}

fragment OddsWithArrow_outcome on OutcomeNode {
  odds
  oddsPrev
}
`;

export const FightOfferTableRefetchQuery = `query FightOfferTableRefetchQuery(
  $fightSlug: String
) {
  fightOfferTable(slug: $fightSlug) {
    ...FightTabPanelOdds_fightOfferTable
    id
  }
}

fragment FightOfferTable_fightOfferTable on FightOfferTableNode {
  slug
  fighter1 {
    firstName
    lastName
    id
  }
  fighter2 {
    firstName
    lastName
    id
  }
  bestOdds1
  bestOdds2
  straightOffers {
    edges {
      node {
        sportsbook {
          id
          shortName
          slug
        }
        outcome1 {
          id
          odds
          oddsOpen
          oddsBest
          oddsWorst
          ...OddsWithArrowButton_outcome
        }
        outcome2 {
          id
          odds
          oddsOpen
          oddsBest
          oddsWorst
          ...OddsWithArrowButton_outcome
        }
        id
      }
    }
  }
}

fragment FightTabPanelOdds_fightOfferTable on FightOfferTableNode {
  ...FightOfferTable_fightOfferTable
  propCount
  slug
}

fragment OddsWithArrowButton_outcome on OutcomeNode {
  id
  ...OddsWithArrow_outcome
}

fragment OddsWithArrow_outcome on OutcomeNode {
  odds
  oddsPrev
}
`;

export const FightPropOfferTableQrQuery = `query FightPropOfferTableQrQuery(
  $fightSlug: String!
) {
  sportsbooks: allSportsbooks(hasOdds: true) {
    ...FightPropOfferTable_sportsbooks
  }
  fightPropOfferTable(slug: $fightSlug) {
    ...FightPropOfferTable_fightPropOfferTable
    id
  }
  offerTypes: allOfferTypes {
    ...FightPropOfferTable_offerTypes
  }
}

fragment FightPropOfferTable_fightPropOfferTable on FightPropOfferTableNode {
  propOffers {
    edges {
      node {
        propName1
        propName2
        bestOdds1
        bestOdds2
        offerType {
          id
        }
        offers {
          edges {
            node {
              sportsbook {
                id
              }
              outcome1 {
                id
                odds
                ...OddsWithArrowButton_outcome
              }
              outcome2 {
                id
                odds
                ...OddsWithArrowButton_outcome
              }
              id
            }
          }
        }
      }
    }
  }
}

fragment FightPropOfferTable_offerTypes on OfferTypeNodeConnection {
  edges {
    node {
      id
    }
  }
}

fragment FightPropOfferTable_sportsbooks on SportsbookNodeConnection {
  edges {
    node {
      id
      shortName
      slug
    }
  }
}

fragment OddsWithArrowButton_outcome on OutcomeNode {
  id
  ...OddsWithArrow_outcome
}

fragment OddsWithArrow_outcome on OutcomeNode {
  odds
  oddsPrev
}
`;
