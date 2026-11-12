// UI string dictionaries (chrome only — member-entered content is never translated).
// Keys mirror the strings objects in the design handoff (HOME_*, PROFILE_*).
// Use `{name}` placeholders; interpolate with `t(key, { name })` in the client.

import { LOCALES, type Capability, type Locale } from "./types.js";

export interface Strings {
  // brand / generic
  brand: string;
  brandSub: string;
  /** Brand subtitle for the calendar app (apps/calendar), which shares `brand`. */
  brandSubCalendar: string;
  done: string;
  save: string;
  cancel: string;
  back: string;

  // onboarding
  signInTitle: string;
  /** Nav/header CTA for a signed-out visitor on a public screen. */
  signInCta: string;
  signInLead: string;
  emailLabel: string;
  emailLink: string;
  privateNote: string;
  checkEmailTitle: string;
  checkEmailLead: string; // uses {email}
  openEmailApp: string;
  resendLink: string;
  signingIn: string;
  signingInSub: string;
  regClosedTitle: string;
  regClosedLead: string;
  regClosedNote: string;

  // nav
  navHome: string;
  navDir: string;
  navGroups: string;
  navMe: string;
  /** The admin entry in every app's nav — one label and one icon (shield) in
   *  all five, where it used to be "Admin" in three and "Settings" in two. */
  navAdmin: string;
  /** The newsletter app's readership screen, for editors. */
  navMetrics: string;
  /** The PTO app's own boards tab. */
  navBoards: string;
  /** The mobile tab, and the desktop sidebar section, that holds the platform
   *  switcher — the four sibling apps. See packages/shared/src/nav.ts. */
  navApps: string;
  /** Lead under the switcher sheet's heading. */
  navAppsLead: string;
  searchMembers: string;
  searchGroups: string;
  myGroups: string;
  allGroups: string;
  aboutGroupsTitle: string;
  aboutGroupsBody: string;
  whatAreGroups: string;
  colName: string;
  colType: string;
  groupsResults: string;
  groupsEmpty: string;
  directoryEmpty: string;
  filterByRole: string;
  filterAllRoles: string;
  /** Groups index: the type filter's group label, and its "no chip on" chip. */
  filterByType: string;
  filterAllTypes: string;
  loadMore: string;
  showingOf: string; // uses {shown} {total}

  // calendar
  navCalendar: string;
  calendarTitle: string;
  upcomingEvents: string;
  noEvents: string;
  searchEvents: string;
  clearSearch: string;
  noEventsMatch: string;
  allDay: string;
  calendars: string;
  /** Dismissible note above the calendar chips, explaining what the chips do.
   *  Two spellings because an instance with one calendar has no show/hide —
   *  `FilterBar` renders the chip as plain text there, so promising a toggle
   *  would describe a control that isn't on the screen. */
  calendarsHint: string;
  calendarsHintOne: string;
  hintDismiss: string;
  downloadIcs: string; // uses {name}
  downloadIcsNote: string;
  subscribeIcs: string; // uses {name}
  subscribeLead: string; // uses {name}
  subscribeApple: string;
  subscribeGoogle: string;
  subscribeOther: string;
  subscribeCopy: string;
  subscribeCopied: string;
  subscribeNote: string;
  /** One event's own page — the dedicated URL at /e/:date/:slug. */
  eventTitle: string;
  eventNotFound: string;
  eventNotFoundBody: string;
  /** The link on an event that happens online (Meet, Zoom, …). */
  eventJoinOnline: string;

  // newsletter (member- and public-facing only; the authoring UI is admin
  // tooling and stays English, as the calendar's admin screens do)
  brandSubNewsletter: string;
  navNewsletter: string;
  newsletterArchive: string;
  newsletterPrefsTitle: string;
  newsletterPrefsLead: string;
  newsletterSubscribeLabel: string;
  newsletterSubscribed: string;
  newsletterUnsubscribed: string;
  unsubscribeTitle: string;
  unsubscribeLead: string; // uses {email}
  unsubscribeConfirm: string;
  unsubscribeDone: string;
  latestIssue: string;

  // volunteer signups (member- and public-facing only; the authoring UI is admin
  // tooling and stays English, as the calendar's other admin screens do)
  volunteersTitle: string;
  volunteersNeeded: string;
  volunteerSpotsFilled: string; // uses {filled} {slots}
  volunteerSpotsLeft: string; // uses {left}
  volunteerFull: string;
  takeASpot: string;
  signInToVolunteer: string;
  volunteerWithdraw: string;
  volunteerWhoFor: string;
  /** Chip on a person in the claim picker who already holds this position —
   *  one signup per Person per position; the rest of the family may still go. */
  volunteerPersonSignedUp: string;
  volunteerNote: string;
  volunteerNeedPerson: string;
  volunteerNotePlaceholder: string;
  volunteerSignupsClosed: string;
  volunteerNoPositions: string;
  /** Link text for a sheet's runbook — the organizers' document on how the
   *  event is run. Members-only; the public sheet never carries the URL. */
  volunteerRunbook: string;
  /** Label on an event's photo-album link (members only). */
  eventAlbum: string;
  /** Calendar nav tab + albums screen title. */
  navAlbums: string;
  albumsTitle: string;
  albumsEmpty: string;
  volunteerNamesMembersOnly: string;
  volunteerAlready: string;
  volunteerTookLastSpot: string;
  volunteerError: string;
  volunteerNotFound: string;
  volunteerNotFoundBody: string;
  /** Leads the title of a volunteer spot added to someone's own calendar:
   *  "Volunteer: Setup crew — Fall Carnival". */
  volunteerEntryPrefix: string;
  volunteerAddToCalendar: string;
  volunteerAddGoogle: string;
  /** The .ics download — Apple Calendar, Outlook and anything else that opens a file. */
  volunteerAddIcs: string;
  volunteerSignedUpTitle: string;
  volunteerSignedUpBody: string;
  /** The live "still needs a hand" list on the PTO's landing page —
   *  upcoming events assembled from the public sheets (counts, never names).
   *  It began life as the calendar's /volunteers screen, which this replaced. */
  volunteersPageLead: string;
  volunteersPageNone: string;

  // home
  neighbors: string;
  noNeighbors: string;
  noNeighborsBody: string;
  seeAll: string;
  groups: string;
  member: string;
  connect: string;
  connected: string;
  yourProfile: string;
  preview: string;
  whatYouShare: string;
  membersN: string;
  privateN: string;
  sharedN: string;
  shownAsNeighbor: string;
  on: string;
  off: string;
  welcome: string; // uses {school}
  addAddressTitle: string;
  addAddressBody: string;
  addAddressBtn: string;
  osmAttribution: string;
  noGroups: string;
  noGroupsBody: string;
  finishTitle: string;
  finishBody: string;
  finishBtn: string;

  // profile
  editProfile: string;
  previewingAsMember: string;
  whatOthersSee: string;
  hiddenFromMembers: string; // uses {count}
  unlistedSection: string;
  unlistedOn: string;
  unlistedOff: string;
  unlistedRemove: string;
  unlistedRestore: string;

  // Directory access (migration 0029, invariant 32). The copy a family reads
  // while they are waiting is the whole of their experience of this gate, so it
  // says what is happening, why, and what they can still do — never "denied".
  accessPendingTitle: string;
  accessPendingBody: string;
  accessDeclinedTitle: string;
  accessDeclinedBody: string;
  accessFormTitle: string;
  accessFormLead: string;
  accessNeedName: string;
  accessNeedStudent: string;
  accessNeedClassroom: string;
  accessOrStaff: string;
  accessNeedStaff: string;
  accessNoteLabel: string;
  accessNotePlaceholder: string;
  accessSubmit: string;
  accessSubmitFailed: string;
  accessSubmitted: string;
  accessMeanwhile: string;
  // The reciprocity half of the gate: the directory stays closed — even to an
  // approved account — until the family has entered at least one contact item.
  accessNeedContact: string;
  accessContactTitle: string;
  accessContactBody: string;
  unlistedBadge: string;
  exitPreview: string;
  contact: string;
  saveContact: string;
  fromGroup: string; // uses {name}
  shareCta: string; // uses {name}
  homeLabel: string;
  mobile: string;
  email: string;
  website: string;
  typeAddress: string;
  typePhone: string;
  exactHidden: string;
  firstName: string;
  lastName: string;
  setupTitle: string;
  setupLead: string;
  createProfileBtn: string;
  skipToAdmin: string;

  // The welcome wizard's second step. A directory of one household member is
  // half a directory, and the complaint this answers was that nobody realized
  // they could add the rest — so the ask is made once, plainly, at the moment
  // someone is already filling things in.
  welcomeFamilyTitle: string;
  welcomeFamilyLead: string;
  welcomeAddChild: string;
  welcomeAddPartner: string;
  welcomeChildHeading: string;
  welcomePartnerHeading: string;
  welcomeAddSubmit: string;
  welcomeAddedLabel: string; // uses {count}
  inviteFailed: string;
  welcomeSkip: string;
  welcomeContinue: string;
  welcomeNameError: string;
  welcomeAddError: string;
  welcomeDoneTitle: string;
  welcomeDoneLead: string;
  welcomeDoneCta: string;
  /** Optional on the partner form: filling it in emails them a link so they end
   *  up managing their own profile rather than being managed by their partner. */
  welcomePartnerEmail: string;
  welcomePartnerEmailNote: string;
  welcomeInviteFailed: string; // uses {name}
  /** The family step's most useful line and the reason the second parent stops
   *  producing duplicates: before the blank "add a child" form, it shows who is
   *  ALREADY in the household. Nothing here is new sight — it is the roster the
   *  group screen renders for the same viewer — so it leaks nothing while
   *  answering the only question the blank form left open. */
  welcomeExistingLabel: string;
  welcomeExistingNote: string;
  /** Shown to a co-parent whose invitation carried the household: the family is
   *  already here, so the step is a review rather than a form. */
  welcomeExistingLead: string;
  /** The partner form's household checkbox — what the invitation hands over. */
  welcomeInviteFamily: string;
  welcomeInviteFamilyNote: string;

  // Removing a Person. Permanent, member-initiated, and the copy has to say so
  // before the tap rather than after it.
  removePerson: string;
  removePersonTitle: string; // uses {name}
  removePersonBody: string; // uses {name}
  removePersonConfirm: string;
  removePersonCounts: string; // uses {contacts}, {groups}
  removePersonSignups: string; // uses {count}
  removePersonEmptied: string; // uses {name}
  removePersonShared: string; // uses {name}
  removePersonHouseholdAdmin: string; // uses {name}
  removePersonError: string;
  /** Household names, composed on the client — the API has no locale. */
  householdAutoName: string; // uses {lastName}
  householdAutoNameFallback: string; // uses {firstName}

  // Home nudges toward the same thing, for anyone who skipped.
  noGroupsCta: string;
  addFamilyTitle: string;
  addFamilyBody: string;
  addFamilyCta: string;
  addFamilyDismiss: string;
  alwaysVisible: string;
  firstFixedWhy: string;
  lnFull: string;
  lnInitial: string;
  shownAs: string;
  photo: string;
  addPhoto: string;
  /** Under the photo upload: one family's upload must not expose another's
   *  children. A request, not a control — nothing checks what is in a photo. */
  photoOwnFamilyHint: string;
  addContact: string;
  showAsNeighbor: string;
  neighborWhy: string;
  whoManages: string;
  inviteCoManager: string; // uses {name}
  owner: string;
  inviteTitle: string; // uses {name}
  inviteWhy: string; // uses {name}
  inviteSend: string;
  inviteSent: string; // uses {email}

  // visibility
  visMembers: string;
  visPrivate: string;
  visShared: string;
  visMembersDesc: string;
  visPrivateDesc: string;
  visSharedDesc: string;
  whoCanSee: string; // uses {field}
  sharedWith: string;
  addPeople: string;

  // groups
  household: string;
  classroom: string;
  genericGroup: string;
  genericGroupSub: string;
  genericManages: string; // uses {name}
  roster: string;
  members: string;
  manage: string;
  youreAdmin: string;
  viewOnly: string;
  classMember: string;
  teachThisClass: string;
  addMember: string;
  /** Classroom self-service: a Controller placing their own child in the room.
   *  Distinct from `addMember`, which is the roster-admin affordance — different
   *  authority, different button, so different copy. */
  myChildren: string;
  addMyChild: string;
  inThisClass: string;
  /** uses {name} — the room(s) the child leaves when they are moved here. */
  movesFrom: string;
  notInAClass: string;
  noStudentsToPlace: string;
  classPlacementNote: string;
  classPlacementFailed: string;
  setTitle: string;
  setTitles: string;
  editGroupInfo: string;
  householdContact: string;
  cascadeNote: string;
  manageMembers: string;
  messageAll: string;
  systemAdmin: string;
  groupAdminRole: string;
  noOneToAdd: string;
  removeFromGroup: string;
  removeMemberConfirm: string; // uses {name}
  removeMemberKeepsPerson: string;
  removeMemberLastAdmin: string;
  removeMemberFailed: string;
  confirmRemove: string;
  appErrorTitle: string;
  appErrorBody: string;
  appErrorReload: string;
  adminManages: string; // uses {name}
  teacherRuns: string; // uses {name}
  newGroup: string;
  newHousehold: string;
  newClassroom: string;
  groupName: string;
  create: string;
  createGroupChoose: string;
  createSubgroup: string;
  subgroups: string;
  parentGroup: string;
  setParentGroup: string;
  parentNone: string;
  noEligibleGroups: string;
  editGroup: string;
  renameGroup: string;
  deleteGroup: string;
  deleteGroupConfirm: string; // uses {name}
  deleteGroupWarn: string; // uses {count}
  deleteGroupKeepsPeople: string;
  deleteGroupHasChildren: string;
  deleteGroupFailed: string;
  renameGroupFailed: string;
  groupType: string;
  groupTypeChangeNote: string;
  changeTypeFailed: string;
  changeTypeHasChildren: string;
  reparentFailed: string;
  reparentRejected: string;
  confirmDelete: string;

  // capabilities (Capability enum labels)
  capParent: string;
  capTeacher: string;
  capStaff: string;
  capStudent: string;
  capHouseholdAdmin: string;

  // person switcher
  actingAs: string;
  addPerson: string;

  // create / add a person
  addPersonTitle: string;
  addPersonLead: string;
  addPersonBtn: string;
  personType: string;
  personTypeNote: string;
  personTypeEditNote: string;
  personHousehold: string;
  personHouseholdNote: string;
  householdNone: string;

  // language
  language: string;
  languageNote: string;

  // site footer — three items on one line, the same three everywhere: the PTO's
  // name (a proper noun, hence not here), where feedback goes, and the source.
  footerFeedback: string; // uses {email}

  // landing page (apps/home — the public front door at eisenhower.school).
  // That page is server-rendered by a Worker with no client bundle, so these
  // are read straight out of `dictionaries` rather than through a provider.
  /** The greeting, in THIS language. Unlike every other string here, all four
   *  locales' copies are rendered at once — the landing page's hero is the
   *  stack of greetings, and it doubles as the language picker. */
  landingWelcome: string;
  landingTitle: string; // uses {school}
  landingDescription: string; // uses {school} {city} {languages}
  landingLead: string; // uses {school}
  /** Names where the school is, in the footer. The place name itself is
   *  configuration (`SCHOOL_CITY`/`SCHOOL_REGION`) and stays in Latin script in
   *  every language, the way it is written on an envelope — only the sentence
   *  around it is translated. */
  landingReadIn: string; // uses {language}
  landingCreateAccount: string;
  landingNoPassword: string;
  landingSeeCalendar: string;
  landingWhatsHere: string;
  landingMembersOnly: string;
  landingOpenToAll: string;
  landingOpen: string; // uses {name}
  landingDirBody: string;
  landingDirMore: string; // uses {feature}
  landingCalBody: string;
  landingCalMore: string; // uses {feature}
  landingNewsTitle: string;
  landingNewsBody: string;
  landingNewsMore: string;
  landingJoinTitle: string;
  landingJoinBody: string; // uses {school}
  // faq — eisenhower.school/faq. The one page here that explains the site
  // rather than being it, so it is written for somebody who has not signed in
  // and may never have seen any of this before.
  faqTitle: string;
  /** The printed sheet's heading. Uses {school}, which is a proper noun and
   *  stays put; only the word around it is translated. Deliberately different
   *  from `faqTitle`: on screen the reader arrived from the site and needs to
   *  know what the PAGE is, while a sheet of paper handed to somebody has to
   *  name the THING it is about before anything else. */
  faqPrintTitle: string; // uses {school}
  faqDescription: string; // uses {school} {city} {languages}
  faqLead: string; // uses {school}
  faqNav: string;
  faqVolunteerTitle: string;
  faqVolunteerBody: string;
  faqGetInTitle: string;
  faqStep1Title: string; // uses {host}
  faqStep1Body: string; // uses {action}
  faqStep2Title: string;
  faqStep2Body: string;
  faqStep3Title: string;
  faqStep3Body: string;
  faqFamilyTitle: string;
  faqFamilyBody: string;
  faqApprovalTitle: string;
  faqApprovalBody: string;
  faqPrivacyTitle: string;
  faqNoPublicLead: string;
  faqNoPublicBody: string; // uses {school}
  faqKnowTitle: string;
  faqAddressTitle: string;
  faqAddressBody: string;
  faqNeighborsTitle: string;
  faqNeighborsBody: string;
  faqUnlistedTitle: string;
  faqUnlistedBody: string;

  // privacy — eisenhower.school/privacy. The formal notice, and the page a
  // family is pointed at when they ask "what do you actually hold?". It is the
  // FIFTH indexed surface, so nothing member-private may appear on it; every
  // word below is a dictionary string or a hostname.
  privacyTitle: string;
  privacyNav: string;
  privacyLead: string; // uses {school}
  privacyDescription: string; // uses {school}
  privacyUpdated: string; // uses {date}
  privacyHoldTitle: string;
  privacyHoldBody: string;
  privacyHoldName: string;
  privacyHoldContact: string;
  privacyHoldPhoto: string;
  privacyHoldChild: string;
  privacyHoldAddress: string;
  privacyDefaultTitle: string;
  privacyDefaultBody: string;
  privacyChildrenTitle: string;
  privacyChildrenBody: string;
  privacyBusTitle: string;
  privacyBusBody: string;
  privacyWhoTitle: string;
  privacyWhoBody: string;
  privacyDeleteTitle: string;
  privacyDeleteBody: string;
  privacyServicesTitle: string;
  privacyServicesBody: string;
  privacyServiceHosting: string;
  privacyServiceEmail: string;
  privacyServiceMaps: string;
  privacyServiceStore: string;
  privacyServiceTranslate: string;
  privacyServiceAdmin: string;
  privacyServiceAi: string;
  privacyServiceFonts: string;
  privacyLostFoundTitle: string;
  privacyLostFoundBody: string;
  /** The front door's lost & found tile (title is `navLostFound`). */
  landingLfBody: string;
  landingLfMore: string;
  faqLostFoundTitle: string;
  faqLostFoundBody: string;
  privacyNeverTitle: string;
  privacyNeverBody: string;
  privacyContactTitle: string;
  privacyContactBody: string;

  landingSchoolSiteLabel: string;
  landingSchoolSiteLink: string;

  // The contacts-and-links block on the landing page, transcribed from the
  // district's back-to-school mailing. Every phone number, URL and street
  // address in it is DATA and lives in `apps/home/src/district.ts`; only the
  // words are here. School names are data too — a proper noun, like a city.
  landingHelpEyebrow: string;
  landingHelpTitle: string;
  landingContactsDistrict: string;
  landingResourcesTitle: string;
  /** The one row whose value is a formatted time range rather than a phone
   *  number, so it has a label and no link. */
  landingFactHours: string;
  landingFactOffice: string;
  landingFactOfficeBody: string;
  landingFactInterpreters: string;
  landingFactInterpretersBody: string;
  landingDeptAthletics: string;
  landingDeptCommunityEd: string;
  landingDeptEarlyChildhood: string;
  landingDeptEarlyChildhoodScreening: string;
  landingDeptHumanResources: string;
  landingDeptSchoolAgeCare: string;
  landingDeptNutrition: string;
  landingDeptSpecialServices: string;
  landingDeptSuperintendent: string;
  landingDeptTransportation: string;
  landingFactEnroll: string;
  landingFactEnrollBody: string;
  landingFactPortal: string;
  landingFactPortalBody: string;
  landingFactBuses: string;
  landingFactBusesBody: string; // uses {email}
  landingFactMeals: string;
  landingFactMealsBody: string;
  landingFactSafety: string;
  landingFactSafetyBody: string;
  landingFactRoyalReport: string;
  landingFactRoyalReportBody: string;

  // cross-cutting states
  offlineBanner: string;
  offlineReadOnly: string;
  offlineNote: string;
  masqViewingAs: string; // uses {name}
  masqReturn: string;
  signOut: string;

  // store (apps/store) — the storefront's chrome only. Product titles, blurbs
  // and variant labels are admin- and vendor-entered content and are never
  // translated (invariant 6), the same rule a newsletter issue's body follows.
  // The admin screens are deliberately English-only, as the calendar's and
  // newsletter's are.
  brandSubStore: string;
  navStore: string;
  storeTitle: string;
  storeLead: string;
  storeEmpty: string;
  storeFrom: string; // uses {price}
  storeSoldOut: string;
  storeChooseOption: string;
  storeAddToCart: string;
  storeCart: string;
  storeCartEmpty: string;
  storeKeepShopping: string;
  storeQty: string;
  storeRemove: string;
  storeSubtotal: string;
  storeShipping: string;
  storeTotal: string;
  storeWhereTo: string;
  storeFullName: string;
  storeEmail: string;
  storeAddress1: string;
  storeAddress2: string;
  storeCity: string;
  storeState: string;
  storePostalCode: string;
  storeCountry: string;
  storePhone: string;
  storeGetShipping: string;
  storeChooseShipping: string;
  storeCheckout: string;
  storeCheckoutNote: string;
  storeOrderTitle: string;
  storeOrderProcessing: string;
  storeOrderShipped: string;
  storeOrderProblem: string;
  storeOrderProblemNote: string;
  storeTracking: string;
  storeOrderNotFound: string;
  storeShipTo: string;
  storePlaced: string;
  storeMadeToOrder: string;
  /** The store's tile on the front door (apps/home). */
  landingStoreBody: string;
  landingStoreMore: string;

  // pto (apps/pto) — the PUBLIC page at pto.eisenhower.school, plus the two
  // things an ordinary member might read on the members-only half.
  //
  // The planning boards themselves are deliberately absent from this block.
  // They are authoring chrome for eight volunteers, like the calendar's and the
  // newsletter's admin screens, and stay English for the same reason. What IS
  // here is the page a family reads and the card a member sees when the boards
  // are not for them — both of which are member-facing copy in invariant 6's
  // sense.
  //
  // EVENT AND PROGRAM NAMES ARE NOT HERE. "Read-A-Thon", "XinXing", "Juntos"
  // and the rest are proper nouns and live in apps/pto/functions/_lib/pto.ts as
  // DATA, the way school and district names live in apps/home/src/district.ts.
  // Only the sentences around them are translated.
  brandSubPto: string;
  navPto: string;
  ptoTitle: string;
  ptoLead: string;
  ptoWhatTitle: string;
  ptoWhatBody: string;
  ptoPillarFund: string;
  ptoPillarFundBody: string;
  ptoPillarCommunity: string;
  ptoPillarCommunityBody: string;
  ptoPillarCulture: string;
  ptoPillarCultureBody: string;
  ptoPillarStaff: string;
  ptoPillarStaffBody: string;
  ptoBoardTitle: string;
  ptoBoardLead: string;
  ptoRolePresident: string;
  ptoRolePresidentBody: string;
  ptoRoleVicePresident: string;
  ptoRoleVicePresidentBody: string;
  ptoRoleSecretary: string;
  ptoRoleSecretaryBody: string;
  ptoRoleTreasurer: string;
  ptoRoleTreasurerBody: string;
  ptoRoleFundraising: string;
  ptoRoleFundraisingBody: string;
  ptoRoleVolunteer: string;
  ptoRoleVolunteerBody: string;
  ptoRoleTeacherRep: string;
  ptoRoleTeacherRepBody: string;
  ptoRoleMemberAtLarge: string;
  ptoRoleMemberAtLargeBody: string;
  ptoYearTitle: string;
  ptoYearLead: string;
  /** Label on the strip of things that run all year, under the month list. */
  ptoYearRound: string;
  /** The six things an event on the year strip can be FOR. The event names
   *  beside them are data; these labels are ours. */
  ptoCatFundraiser: string;
  ptoCatCommunity: string;
  ptoCatCultural: string;
  ptoCatAppreciation: string;
  ptoCatEnrichment: string;
  ptoCatGovernance: string;
  ptoMeetingsTitle: string;
  /** Uses {place} — the room is a proper noun and lives in
   *  apps/pto/functions/_lib/pto.ts, like every other one on that page. */
  ptoMeetingsBody: string; // uses {place}
  ptoHelpTitle: string;
  ptoHelpLead: string;
  ptoHelpMeeting: string;
  ptoHelpMeetingBody: string;
  /** The Resource Center wishlist card's title on /resource-center. */
  ptoHelpWishlist: string;
  ptoHelpShop: string;
  ptoHelpShopBody: string;
  /** /resource-center's link back to the landing page's "Ways to help"
   *  section, which carries the volunteer list and the wishlists since
   *  /how-to-help folded into it. */
  ptoHelpMoreCta: string;
  /** Accessible name of the hero's jump-link row; the chips themselves reuse
   *  the section headings, so this is the row's only copy of its own. */
  ptoOnThisPage: string;
  ptoHowResourceTitle: string;
  ptoHowResourceLead: string;
  ptoHowResourceWhat: string;
  ptoHowResourceWhatBody: string;
  ptoHowResourceWho: string;
  ptoHowResourceWhoBody: string;
  /** The standing ask from the FRC's own flyer: regular volunteers who shop
   *  and keep the shelves organized. The card's link is the FRC's own
   *  sign-up sheet (`FRC_SIGNUP` in apps/pto's `_lib/pto.ts`), so the body
   *  points at "the sign-up sheet" rather than naming the service. */
  ptoHowResourceVolunteer: string;
  ptoHowResourceVolunteerBody: string;
  ptoHowResourceGive: string;
  ptoHowResourceGiveBody: string;
  /** The note under the Resource Center cards, addressed to a family that
   *  needs it rather than one that can give. The page appends the assistance
   *  form and the office phone as links, so the sentence must read complete
   *  without them. */
  ptoHowResourceNoteTitle: string;
  ptoHowResourceNoteBody: string;
  /** The label on the appended assistance-form link — the URL itself is
   *  `ASSISTANCE_FORM_URL` in apps/pto's `_lib/pto.ts`. A description, not a
   *  proper noun: the FRC's flyer translates the form's name itself. */
  ptoHowResourceFormCta: string;
  /** /resource-center's featured-need block — the first thing on the page,
   *  swapped roughly monthly by rewriting Title and Body in all four
   *  languages (the Tag stays put). Current: the winter clothing drive from
   *  the school's Oct 2026 newsletter. “WINTER GEAR DRIVE” is the label on
   *  the front office's own bin, so it stays verbatim in every language. */
  ptoResourceFeaturedTag: string;
  ptoResourceFeaturedTitle: string;
  ptoResourceFeaturedBody: string;
  /** Heading of /resource-center's highlighted "Ways to donate" group. */
  ptoResourceDonateTitle: string;
  /** The gift-card card. No URL to carry: the ask is a card left at the
   *  front office, so the card's one link dials the FRC (`FRC_PHONE`). */
  ptoResourceGiftCards: string;
  ptoResourceGiftCardsBody: string;
  /** The direct-dollar card; its link is `SQUARE_STORE` in apps/pto's
   *  `_lib/pto.ts`. */
  ptoResourceSquare: string;
  ptoResourceSquareBody: string;
  ptoResourceSquareCta: string;
  /** Label on the volunteer card's link to `FRC_SIGNUP`. */
  ptoResourceSignupCta: string;
  /** The heading over the live list of events that still have an open spot. */
  ptoHowVolunteerOpen: string;
  /** Label before the strip of events that come back every year and always
   *  need hands; the event names beside it are data (proper nouns). */
  ptoHowVolunteerRecurring: string;
  ptoHowWishlistTitle: string;
  ptoHowWishlistLead: string;
  /** The link on each wishlist card. */
  ptoHowWishlistOpen: string;
  ptoHowWishlistLounge: string;
  ptoHowWishlistLoungeBody: string;
  ptoHowWishlistArt: string;
  ptoHowWishlistArtBody: string;
  /** The Resource Center's wishlist card; its TITLE reuses
   *  `ptoHowResourceTitle`, so only the body is a key of its own. */
  ptoHowWishlistFrcBody: string;
  /** The classroom table under the school-wide cards. Teacher names, room
   *  labels and URLs are data (`TEACHER_WISHLISTS` in apps/pto's
   *  `_lib/pto.ts`); these are the words around them. */
  ptoHowWishlistClassTitle: string;
  ptoHowWishlistClassLead: string;
  /** Placeholder and accessible name of the filter box. It ships `hidden` and
   *  the page's one inline script reveals it, so without JS the complete list
   *  simply renders. */
  ptoHowWishlistFilter: string;
  /** Shown when the filter hides every row. */
  ptoHowWishlistFilterNone: string;
  ptoHowWishlistNoteTitle: string;
  ptoHowWishlistNoteBody: string;
  ptoDonateTitle: string;
  ptoDonateLead: string;
  ptoDonateCta: string;
  ptoDonateNote: string;
  ptoFindTitle: string;
  ptoFindLead: string;
  /** The nonprofit's own registration facts — the block under "Find us". The
   *  name, address, phone and EIN beside these labels are data, in
   *  apps/pto/functions/_lib/pto.ts. */
  ptoOrgTitle: string;
  ptoOrgEin: string;
  ptoOrgNote: string;
  /** Shown to a signed-in member who is not on the PTO board. Translated
   *  because an ordinary member is exactly who reads it. */
  ptoNoAccessTitle: string;
  ptoNoAccessBody: string;
  ptoNoAccessNote: string;
  /** The PTO's tile on the front door (apps/home). */
  landingPtoBody: string;
  landingPtoMore: string;
  /** The Resource Center's own tile on the front door (apps/home), which
   *  links straight to /resource-center on the PTO's site. Its title and
   *  body reuse `ptoHowResourceTitle` / `ptoHowResourceLead`, so only the
   *  "more" line is a key of its own. */
  landingFrcMore: string;
  /** Lost & found (apps/lostandfound): the public browse and claim screens,
   *  the platform switcher's label and the staff no-access card. The staff
   *  screens themselves are English-only authoring chrome, like the PTO
   *  boards'. `lfCat*` / `lfColor*` are display names for the fixed
   *  LF_CATEGORIES / LF_COLORS values. */
  navLostFound: string;
  brandSubLostFound: string;
  lfNavBrowse: string;
  lfNavStaff: string;
  lfBrowseTitle: string;
  lfBrowseLead: string;
  /** Tip under the browse lead linking to fabric name labels parents recommend. */
  lfLabelTip: string;
  /** The count up top: how many items are listed in all. One/many forms. */
  lfItemCountOne: string;
  lfItemCount: string;
  /** The one-line stat when items have gone home: composes the two phrases
   *  below, so each language owns its comma and ordering. When nothing has
   *  been returned yet, the lfItemCount pair above renders alone instead. */
  lfCounts: string;
  lfCountsFoundOne: string;
  lfCountsFound: string;
  lfCountsReturnedOne: string;
  lfCountsReturned: string;
  lfSearchPlaceholder: string;
  lfSearchLabel: string;
  lfAllCategories: string;
  lfCategoryLabel: string;
  lfColorLabel: string;
  lfBestMatches: string;
  lfNoMatches: string;
  lfEmpty: string;
  lfShowMore: string;
  lfDescribing: string;
  lfFoundToday: string;
  lfFoundYesterday: string;
  lfFoundDaysAgo: string;
  lfLoadError: string;
  lfItemGone: string;
  lfBackToAll: string;
  lfFactCategory: string;
  lfFactColors: string;
  lfFactBrand: string;
  lfFactMaterial: string;
  lfFactWhere: string;
  lfFactFound: string;
  lfAutoDescribed: string;
  lfZoomIn: string;
  lfZoomOut: string;
  lfZoomReset: string;
  lfZoomHint: string;
  lfPendingNote: string;
  lfClaimTitle: string;
  lfClaimLead: string;
  lfClaimCta: string;
  lfClaimName: string;
  lfClaimContact: string;
  lfClaimChild: string;
  lfClaimTeacher: string;
  lfClaimMessage: string;
  lfClaimMessageHint: string;
  lfClaimSend: string;
  lfClaimSending: string;
  lfClaimThanksTitle: string;
  lfClaimThanksBody: string;
  lfClaimError: string;
  lfClaimPrivacy: string;
  /** Nudge under the claim form's contact field: an email address can get an
   *  automatic note back when the item is returned; anything else is read and
   *  answered by a person. */
  lfClaimContactHint: string;
  /** The return notification — the ONE message the lost & found sends a
   *  claimant, built by `lostFoundReturnMessage` (lostFoundReturn.ts) for both
   *  the API's email and the staff dashboard's prefilled text/copy message, in
   *  the language the claim form was filled in. Names the item and the school,
   *  NEVER a child: a mistyped contact must not deliver a child's name to a
   *  stranger. `{item}`, `{school}`. */
  lfReturnSubject: string;
  lfReturnBodyClassroom: string;
  lfReturnBodyOffice: string;
  lfReturnBodyFamily: string;
  lfReturnClosing: string;
  /** Stands in for `{item}` when the item has no title (the AI failed and
   *  staff published anyway) — prose, unlike `lfDescribing`, which is the
   *  browse grid's progress placeholder and reads absurd in an email. */
  lfReturnItemFallback: string;
  /** The public browse page's quiet sign-in link. Submitting an item (any
   *  signed-in member) and the staff screens both start at the same sign-in. */
  lfSignInToAdd: string;
  /** The member submit screen — translated, unlike the staff screens: any
   *  family may use it (invariant 33: a member's item stays held until staff
   *  publish it). */
  lfNavSubmit: string;
  lfSubmitTitle: string;
  lfSubmitLead: string;
  lfSubmitLocation: string;
  lfSubmitLocationHint: string;
  lfSubmitPlaceholder: string;
  lfSubmitChoose: string;
  lfSubmitAddMore: string;
  lfSubmitChooseHint: string;
  lfSubmitNotice: string;
  lfSubmitOne: string;
  lfSubmitMany: string;
  lfSubmitClear: string;
  lfSubmitPreparing: string;
  lfSubmitWaiting: string;
  lfSubmitUploading: string;
  lfSubmitDone: string;
  lfSubmitFailed: string;
  lfSubmitReadError: string;
  lfSubmitRotateError: string;
  /** On the public item page, for signed-in staff only: straight to the editor. */
  lfStaffEdit: string;
  lfNoAccessTitle: string;
  lfNoAccessBody: string;
  lfNoAccessNote: string;
  lfCatWaterBottle: string;
  lfCatLunchBox: string;
  lfCatJacket: string;
  lfCatSweatshirt: string;
  lfCatClothing: string;
  lfCatWinterWear: string;
  lfCatShoes: string;
  lfCatBag: string;
  lfCatElectronics: string;
  lfCatGlasses: string;
  lfCatJewelry: string;
  lfCatToy: string;
  lfCatSchoolSupplies: string;
  lfCatSports: string;
  lfCatOther: string;
  lfColorBlack: string;
  lfColorWhite: string;
  lfColorGray: string;
  lfColorSilver: string;
  lfColorRed: string;
  lfColorPink: string;
  lfColorOrange: string;
  lfColorYellow: string;
  lfColorGold: string;
  lfColorGreen: string;
  lfColorBlue: string;
  lfColorNavy: string;
  lfColorPurple: string;
  lfColorBrown: string;
  lfColorTan: string;
  lfColorMulticolor: string;

  // bingo (apps/bingo) — the game-night board. The letters and numbers are the
  // game itself, not copy; these are the chrome around them. The sign-in form
  // reuses signInLead / emailLabel / emailLink / checkEmailTitle / checkEmailLead.
  bingoViewOnly: string;
  bingoSignInTitle: string;
  bingoSyncError: string;

  // bingo card scanner (apps/bingo, /scan) — point the phone camera at ANY
  // Finger-Tip shutter card (no registration; the school owns 500+) and it
  // reads the printed numbers, sees which shutters are slid, and referees
  // against the live board. A tap corrects a misread square.
  bingoScanTitle: string;
  bingoScanAlign: string;
  bingoScanReading: string; // uses {done} {total}
  bingoScanBingo: string;
  bingoScanClean: string;
  bingoScanFalseMarks: string; // uses {nums}
  bingoScanMissed: string; // uses {nums}
  bingoScanCamera: string;
  bingoScanPhoto: string;
  bingoScanFixHint: string;
  bingoScanNext: string;
}

const en: Strings = {
  brand: "Eisenhower",
  brandSub: "PTO Directory",
  brandSubCalendar: "PTO Calendar",
  done: "Done",
  save: "Save",
  cancel: "Cancel",
  back: "Back to sign in",

  signInTitle: "Sign in to the directory",
  signInCta: "Sign in",
  signInLead:
    "Enter your email and we'll send you a link to sign in. No password to remember.",
  emailLabel: "Email",
  emailLink: "Email me a link",
  privateNote: "Private to the {school} community. Nothing here is public.",
  checkEmailTitle: "Check your email",
  checkEmailLead:
    "We sent a sign-in link to {email}. It expires in 15 minutes.",
  openEmailApp: "Open email app",
  resendLink: "Resend link",
  signingIn: "Signing you in…",
  signingInSub: "One moment while we open the directory.",
  regClosedTitle: "Thanks — check your email",
  regClosedLead:
    "If this email belongs to a {school} member, a sign-in link is on its way.",
  regClosedNote:
    "For everyone's privacy, we don't confirm whether an account exists. New sign-ups are managed by the school office.",

  navHome: "Home",
  navDir: "Directory",
  navGroups: "Groups",
  navMe: "You",
  navAdmin: "Admin",
  navMetrics: "Metrics",
  navBoards: "Boards",
  navApps: "Apps",
  navAppsLead: "The rest of the site. One account works everywhere.",
  searchMembers: "Search members",
  searchGroups: "Search groups",
  myGroups: "Your groups",
  allGroups: "All groups",
  aboutGroupsTitle: "What's a group?",
  aboutGroupsBody:
    "Groups organize the community. A Household is your family; a Classroom is a teacher's class. Schools can also use groups for a Grade, the whole School, or clubs and committees. A person can belong to several groups at once.",
  whatAreGroups: "What are groups?",
  colName: "Name",
  colType: "Type",
  groupsResults: "Results",
  groupsEmpty: "No groups match your search.",
  directoryEmpty: "No members match your search.",
  filterByRole: "Filter by role",
  filterAllRoles: "Everyone",
  filterByType: "Filter by type",
  filterAllTypes: "All types",
  loadMore: "Load more",
  showingOf: "Showing {shown} of {total}",

  navCalendar: "Calendars",
  calendarTitle: "Calendar",
  upcomingEvents: "Upcoming events",
  noEvents: "No upcoming events",
  searchEvents: "Search events",
  clearSearch: "Clear search",
  noEventsMatch: "No events match your search.",
  allDay: "All day",
  calendars: "Calendars",
  calendarsHint:
    "Select a calendar to hide its events, and again to bring them back. The + adds one to the calendar app you already use, so new and changed dates arrive on their own.",
  calendarsHintOne:
    "The + adds this calendar to the app you already use, so new and changed dates arrive on their own.",
  hintDismiss: "Dismiss",
  downloadIcs: "Download {name} (.ics)",
  downloadIcsNote:
    "A one-time copy of today's dates. It won't update when the school's plans change.",
  subscribeIcs: "Subscribe to {name}",
  subscribeLead:
    "Add {name} to the calendar app you already use. New and changed events arrive on their own — you won't need to come back here.",
  subscribeApple: "Apple Calendar or Outlook",
  subscribeGoogle: "Google Calendar",
  subscribeOther: "Or paste this link into any calendar app",
  subscribeCopy: "Copy link",
  subscribeCopied: "Copied",
  subscribeNote:
    "Calendar apps check for updates on their own schedule, so a change can take a few hours to show up.",
  eventTitle: "Event",
  eventNotFound: "Event not found",
  eventNotFoundBody:
    "This event may have been moved or taken down. The calendar has what's coming up.",
  eventJoinOnline: "Join online",

  brandSubNewsletter: "PTO Newsletter",
  navNewsletter: "Newsletters",
  newsletterArchive: "Past issues",
  newsletterPrefsTitle: "Newsletter",
  newsletterPrefsLead: "Choose whether the school newsletter is sent to your email address.",
  newsletterSubscribeLabel: "Email me the newsletter",
  newsletterSubscribed: "You're subscribed.",
  newsletterUnsubscribed: "You won't receive the newsletter.",
  unsubscribeTitle: "Unsubscribe",
  unsubscribeLead: "Stop sending the newsletter to {email}?",
  unsubscribeConfirm: "Yes, unsubscribe me",
  unsubscribeDone: "You've been unsubscribed.",
  latestIssue: "Latest newsletter",

  volunteersTitle: "Volunteers",
  volunteersNeeded: "Volunteers needed",
  volunteerSpotsFilled: "{filled} of {slots} filled",
  volunteerSpotsLeft: "{left} still needed",
  volunteerFull: "All filled",
  takeASpot: "Take a spot",
  signInToVolunteer: "Sign in to volunteer",
  volunteerWithdraw: "Give up spot",
  volunteerWhoFor: "Who is signing up?",
  volunteerPersonSignedUp: "Already signed up",
  volunteerNote: "Note (optional)",
  volunteerNeedPerson:
    "Add yourself or a family member first, then you can sign them up for a spot.",
  volunteerNotePlaceholder: "Anything the organizer should know",
  volunteerSignupsClosed: "Signups are closed.",
  volunteerNoPositions: "No positions have been posted yet.",
  volunteerRunbook: "How this event is run",
  eventAlbum: "Photo album",
  navAlbums: "Photos",
  albumsTitle: "Event photo albums",
  albumsEmpty: "No albums yet. When the PTO shares one for an event, it will appear here.",
  volunteerNamesMembersOnly: "Sign in to see who has signed up.",
  volunteerAlready: "Already signed up for this.",
  volunteerTookLastSpot: "Someone just took the last spot.",
  volunteerError: "That didn't work. Please try again.",
  volunteerNotFound: "Signup sheet not found",
  volunteerNotFoundBody: "This link may have expired, or signups were taken down.",
  volunteerEntryPrefix: "Volunteer",
  volunteerAddToCalendar: "Add to calendar",
  volunteerAddGoogle: "Google Calendar",
  volunteerAddIcs: "Apple, Outlook & others (.ics)",
  volunteerSignedUpTitle: "You're signed up",
  volunteerSignedUpBody: "Put it on your calendar so it doesn't slip. If the school moves the event, the calendar entry links back here to the latest details.",
  volunteersPageLead: "Upcoming events that still need a hand. Open one to see the shifts and sign up.",
  volunteersPageNone: "Nothing needs volunteers right now — every open spot is taken. Check back soon.",

  neighbors: "Neighbors",
  noNeighbors: "No neighbors nearby yet.",
  noNeighborsBody:
    "Neighbors appear once other members within 2 miles turn on “Show me as a neighbor” for their address. Your own household isn't listed here.",
  seeAll: "See all",
  groups: "Your groups",
  member: "Member",
  connect: "Connect",
  connected: "Connected",
  yourProfile: "Your profile",
  preview: "Preview",
  whatYouShare: "What you share",
  membersN: "Members",
  privateN: "Private",
  sharedN: "Shared",
  shownAsNeighbor: "Shown as a neighbor",
  on: "On",
  off: "Off",
  welcome: "Welcome to {school}",
  addAddressTitle: "Add your address to see neighbors",
  addAddressBody:
    "We'll show nearby members and a rough distance — never your exact address.",
  addAddressBtn: "Add address",
  osmAttribution: "Distances © OpenStreetMap contributors",
  noGroups: "You're not in any groups yet",
  noGroupsBody:
    "Create your household to add the people you live with. Classrooms are added by a teacher or the office.",
  finishTitle: "Finish your profile",
  finishBody: "Add a phone or photo so your groups can reach you.",
  finishBtn: "Continue setup",

  editProfile: "Edit profile",
  previewingAsMember: "Previewing as a member",
  whatOthersSee: "This is what other members see",
  hiddenFromMembers: "{count} hidden from members",
  unlistedSection: "Directory listing",
  unlistedOn: "Off the roster. Hidden from other members' directory, search, group rosters and neighbours — still visible to admins and to whoever manages this profile.",
  unlistedOff: "Listed normally, like every other member.",
  unlistedRemove: "Remove from directory",
  unlistedRestore: "Restore to directory",
  accessPendingTitle: "We're checking your request",
  accessPendingBody:
    "Someone from the PTO is reviewing what you entered. This is usually quick. You'll be able to see the directory as soon as it's approved.",
  accessDeclinedTitle: "We couldn't match your request",
  accessDeclinedBody:
    "We weren't able to match what you entered to a family at the school. If something is wrong or missing — a misspelled name, the wrong classroom — fix it below and ask again.",
  accessFormTitle: "Ask to see the directory",
  accessFormLead:
    "The directory holds other families' names and contact details, so we check that each account belongs to a school family before opening it. Tell us who you are and who your child is, and we'll take a look.",
  accessNeedName: "Add your own first and last name",
  accessNeedStudent: "Add at least one child",
  accessNeedClassroom: "Choose your child's classroom",
  accessOrStaff: "Or, if you work at the school",
  accessNeedStaff: "Mark yourself as a teacher or staff member, and tell us below which room or job",
  accessNoteLabel: "Anything else we should know? (optional)",
  accessNotePlaceholder: "e.g. we started in January, or my child goes by a different name",
  accessSubmit: "Ask for access",
  accessSubmitFailed: "That didn't go through. Check the steps above and try again.",
  accessSubmitted: "Request sent",
  accessMeanwhile:
    "In the meantime you can use the calendar, sign up to volunteer, read the newsletter and manage your own family.",
  accessNeedContact: "Add at least one way to reach your family — a phone number, email, or address",
  accessContactTitle: "Add your contact info",
  accessContactBody:
    "One more step. The directory works both ways: families share how to reach each other. Add at least one phone number, email, or address to your profile and the directory will open.",
  unlistedBadge: "Unlisted",
  exitPreview: "Exit preview",
  contact: "Contact",
  saveContact: "Save contact",
  fromGroup: "via {name}",
  shareCta: "Share your info with {name}",
  homeLabel: "Home Address",
  mobile: "Mobile",
  email: "Email",
  website: "Website",
  typeAddress: "Address",
  typePhone: "Phone",
  exactHidden: "Exact address hidden",
  firstName: "First name",
  lastName: "Last name",
  setupTitle: "Set up your profile",
  setupLead: "Add your name so your community can recognize you in the directory.",
  createProfileBtn: "Create my profile",
  skipToAdmin: "Skip to admin console",
  welcomeFamilyTitle: "Who else is in your home?",
  welcomeFamilyLead:
    "Add your children and your partner so your family appears together. You can always do this later.",
  welcomeAddChild: "Add a child",
  welcomeAddPartner: "Add my partner",
  welcomeChildHeading: "Your child",
  welcomePartnerHeading: "Your partner",
  welcomeAddSubmit: "Add",
  welcomeAddedLabel: "Added so far: {count}",
  inviteFailed: "We couldn't send that invitation. Check the email address and try again.",
  welcomeSkip: "Skip for now",
  welcomeContinue: "Continue",
  welcomeNameError: "We couldn't create your profile. Please try again.",
  welcomeAddError: "We couldn't add them. Please try again.",
  welcomeDoneTitle: "You're all set",
  welcomeDoneLead:
    "Your household is in the directory. You can add more people any time from Groups.",
  welcomeDoneCta: "Go to the directory",
  welcomePartnerEmail: "Their email (optional)",
  welcomePartnerEmailNote:
    "We'll email them a link so they can manage their own profile.",
  welcomeInviteFailed:
    "{name} was added, but the invitation email didn't send. You can invite them later from their profile.",
  welcomeExistingLabel: "Already in your household",
  welcomeExistingNote: "Someone in your family already added these people. No need to add them again.",
  welcomeExistingLead:
    "Your family is already here — added by whoever set this up. Add anyone who's missing.",
  welcomeInviteFamily: "Let them manage our whole household",
  welcomeInviteFamilyNote:
    "They'll be able to see and edit everyone here, so they don't have to add the family again.",
  removePerson: "Remove from the directory",
  removePersonTitle: "Remove {name}?",
  removePersonBody:
    "This permanently deletes {name} and everything on their profile. It can't be undone.",
  removePersonConfirm: "Yes, remove permanently",
  removePersonCounts: "{contacts} contact details and {groups} group memberships will be deleted.",
  removePersonSignups: "{count} volunteer sign-ups will be cancelled.",
  removePersonEmptied: "{name} is the last member of their household, so the household goes too.",
  removePersonShared:
    "Someone else also manages {name}, so they aren't yours alone to remove. Ask them to stop managing {name} first.",
  removePersonHouseholdAdmin:
    "{name} is the only manager of a household that still has other members. Add another manager there first.",
  removePersonError: "Couldn't remove them. Try again.",
  householdAutoName: "The {lastName} family",
  householdAutoNameFallback: "{firstName}'s household",
  noGroupsCta: "Create your household",
  addFamilyTitle: "Add your family",
  addFamilyBody:
    "Add your children and your partner so your family appears together in the directory.",
  addFamilyCta: "Add family",
  addFamilyDismiss: "Maybe later",
  alwaysVisible: "Always visible",
  firstFixedWhy:
    "People need a name to recognize you. You choose everything else.",
  lnFull: "Full",
  lnInitial: "Initial",
  shownAs: "Shown as",
  photo: "Profile photo",
  addPhoto: "Add photo",
  photoOwnFamilyHint: "Please only upload a photo of your own family — not other people's children.",
  addContact: "Add contact item",
  showAsNeighbor: "Show me as a neighbor",
  neighborWhy:
    "Shows only your name and rough distance to nearby members — never your address.",
  whoManages: "Who manages this profile",
  inviteCoManager: "Invite someone to help manage {name}",
  owner: "Owner",
  inviteTitle: "Invite someone to help manage {name}",
  inviteWhy:
    "They'll become a co-manager and can edit {name}'s profile. You keep access too.",
  inviteSend: "Send invitation",
  inviteSent: "Invitation sent to {email}.",

  visMembers: "Members",
  visPrivate: "Private",
  visShared: "Shared",
  visMembersDesc: "Anyone signed in to {school}",
  visPrivateDesc: "Only you, until you share",
  visSharedDesc: "Private, plus the people and groups you pick",
  whoCanSee: "Who can see your {field}?",
  sharedWith: "Shared with",
  addPeople: "Add people or groups",

  household: "Household",
  classroom: "Classroom",
  genericGroup: "Group",
  genericGroupSub: "School, grade, club, or committee",
  genericManages: "{name} manages this group.",
  roster: "Roster",
  members: "Members",
  manage: "Manage",
  youreAdmin: "You're an admin",
  viewOnly: "Member · view only",
  classMember: "Class member",
  teachThisClass: "You teach this class",
  addMember: "Add member",
  myChildren: "My children",
  addMyChild: "Add my child",
  inThisClass: "In this class",
  movesFrom: "Currently in {name} — this moves them.",
  notInAClass: "Not in a class yet",
  noStudentsToPlace: "None of your children are set up as students yet.",
  classPlacementNote: "A child is in one class at a time. You can change it whenever it's wrong.",
  classPlacementFailed: "Couldn't change their class. Try again.",
  setTitle: "Set title",
  setTitles: "Set titles",
  editGroupInfo: "Edit info",
  householdContact: "Household contact",
  cascadeNote: "Cascades to everyone in the household.",
  manageMembers: "Manage members",
  messageAll: "Message all",
  adminManages: "{name} manages this household. Ask an admin to make changes.",
  teacherRuns: "{name} runs this classroom. You can see classmates who share with members.",
  newGroup: "New",
  newHousehold: "New household",
  newClassroom: "New classroom",
  groupName: "Name",
  create: "Create",
  createGroupChoose: "What would you like to create?",
  createSubgroup: "Create sub-group",
  subgroups: "Sub-groups",
  parentGroup: "Parent group",
  setParentGroup: "Set parent group",
  parentNone: "No parent (top level)",
  noEligibleGroups: "No eligible groups.",
  editGroup: "Edit group",
  renameGroup: "Rename",
  deleteGroup: "Delete group",
  deleteGroupConfirm: "Delete “{name}”?",
  deleteGroupWarn: "This can't be undone.",
  deleteGroupKeepsPeople: "The {count} people in it stay in the directory — only the group and the contact info it shares are removed.",
  deleteGroupHasChildren: "Move or delete its sub-groups first.",
  deleteGroupFailed: "Couldn't delete this group.",
  renameGroupFailed: "Couldn't rename this group.",
  groupType: "Type",
  groupTypeChangeNote: "The type decides what the group does. Only a household shares an address with its members and appears in neighbor discovery.",
  changeTypeFailed: "Couldn't change this group's type.",
  changeTypeHasChildren: "A household can't hold sub-groups — move them out first.",
  reparentFailed: "Couldn't move this group.",
  reparentRejected: "That group can't be the parent — pick another.",
  confirmDelete: "Yes, delete",
  systemAdmin: "System admin",
  groupAdminRole: "Group admin",
  noOneToAdd: "No one left to add.",
  removeFromGroup: "Remove from group",
  removeMemberConfirm: "Remove {name} from this group?",
  removeMemberKeepsPerson: "They stay in the directory and in every other group they belong to.",
  removeMemberLastAdmin: "Make someone else an admin first.",
  removeMemberFailed: "Couldn't remove them from the group.",
  confirmRemove: "Yes, remove",
  appErrorTitle: "This screen stopped working",
  appErrorBody: "Something went wrong on our side. Reloading usually fixes it — nothing you entered was sent.",
  appErrorReload: "Reload",

  capParent: "Parent",
  capTeacher: "Teacher",
  capStaff: "Staff",
  capStudent: "Student",
  capHouseholdAdmin: "Household admin",

  actingAs: "Acting as",
  addPerson: "Add a person",

  addPersonTitle: "Add a person",
  addPersonLead: "Add a child, partner, or someone else you manage. You'll be able to act as them to edit their profile.",
  addPersonBtn: "Add person",
  personType: "Type",
  personTypeNote: "Optional. You can change this later.",
  personTypeEditNote: "Shown as tags beside the name in the directory.",
  personHousehold: "Household",
  personHouseholdNote: "Optional. Adds them to a household so its shared address applies.",
  householdNone: "No household",

  language: "Language",
  languageNote: "Changes the directory for you only.",

  footerFeedback: "Feedback to {email}",

  landingWelcome: "Welcome",
  landingTitle: "{school} — directory, calendar and newsletter",
  landingDescription:
    "The directory, calendar, newsletter and volunteer sign-ups for {school} families in {city}. Available in {languages}.",
  landingLead:
    "Everything the {school} keeps for families, in one place — a directory of who's who, the school calendar, and the newsletter. One account opens all three.",
  landingReadIn: "Read this page in {language}",
  landingCreateAccount: "Create your account",
  landingNoPassword: "No password to remember — we email you a sign-in link.",
  landingSeeCalendar: "See the calendar",
  landingWhatsHere: "What's here",
  landingMembersOnly: "Members only",
  landingOpenToAll: "Open to everyone",
  landingOpen: "Open {name}",
  landingDirBody:
    "Look up a classmate's family, a teacher, or whoever runs the thing you signed up for. Every detail you add starts private, and you decide field by field who can see it.",
  landingDirMore:
    "{feature}: opt in and see which member families live near you — a name and a rough distance, never an address.",
  landingCalBody:
    "Concerts, conferences, picnics, lunch menus, no-school days. Subscribe once and the school year keeps itself up to date in the calendar app you already use.",
  landingCalMore: "{feature}: claim a spot at an event straight from its page.",
  landingNewsTitle: "Newsletter",
  landingNewsBody:
    "PTO news in your inbox every few weeks — what's coming up, what got done, and what still needs hands.",
  landingNewsMore:
    "Anyone can subscribe, and every past issue is on the web. No account needed.",
  landingJoinTitle: "Join the directory",
  landingJoinBody:
    "It takes a couple of minutes. Nothing here is ever public — the directory is closed to everyone outside the {school} community, and you choose what the rest of it sees.",
  faqTitle: "How this works",
  faqPrintTitle: "{school} Website",
  faqDescription:
    "What {school} keeps online for families in {city} — the directory, the calendar, volunteer sign-ups and the newsletter — how to get an account, and who can see what. Available in {languages}.",
  faqLead:
    "Everything the {school} keeps for families lives here: who's who, what's coming up, and what still needs hands. One account opens all of it, and there is no password to remember — we email you a sign-in link instead.",
  faqNav: "How this works",
  faqVolunteerTitle: "Volunteer sign-ups",
  faqVolunteerBody:
    "Every event page shows which spots are still open, and anyone can see the count. Claiming one needs an account, so the PTO knows who to expect.",
  faqGetInTitle: "How to get in",
  faqStep1Title: "Go to {host}",
  faqStep1Body: "Choose {action}.",
  faqStep2Title: "Enter your email",
  faqStep2Body: "That's the whole form. We never ask for a password, because there isn't one.",
  faqStep3Title: "Click the link we send you",
  faqStep3Body:
    "It arrives in a minute or two and is good for fifteen. Signing in later works exactly the same way.",
  faqFamilyTitle: "Then add your family.",
  faqFamilyBody:
    "The setup asks who else is in your home so your family appears together — your children, and your partner, who gets their own sign-in and can manage the same family. You can do this later instead; nothing is locked in.",
  faqApprovalTitle: "We check before opening the directory",
  faqApprovalBody:
    "Because the directory holds other families' names and contact details, someone from the PTO checks that each new account belongs to a school family — you tell us who your child is and which classroom they're in, and we take a look. It's usually quick. While you wait you can already use the calendar, sign up to volunteer and read the newsletter.",
  faqPrivacyTitle: "Who sees what — you decide, detail by detail",
  faqNoPublicLead: "There is no fourth setting.",
  faqNoPublicBody:
    "Nothing in the directory is ever public. It is closed to everyone outside the {school} community, and search engines are told to stay out. Your phone number, your email and your address each carry their own setting, so you can be findable without being reachable, or the reverse.",
  faqKnowTitle: "Good to know",
  faqAddressTitle: "Your street address stays yours",
  faqAddressBody:
    "Other members never see the exact address you enter — only the household it belongs to. Nobody outside the directory sees anything at all.",
  faqNeighborsTitle: "Neighbors is opt-in",
  faqNeighborsBody:
    "Turn on \u201Cshow me as a neighbor\u201D for an address and member families within two miles can find you: a name and a rough distance, never a street address. Leave it off and you simply don't appear.",
  faqUnlistedTitle: "You can step off the roster",
  faqUnlistedBody:
    "If you would rather not be listed at all, write to us and we'll take your family out of the directory. You keep your account, the calendar and the newsletter.",
  privacyTitle: "Privacy",
  privacyNav: "Privacy",
  privacyLead:
    "{school} runs this site for the families of the school. This page says what it holds, who can see it, and what we will never collect. It is written to be read, not to be agreed to.",
  privacyDescription:
    "What the {school} directory holds about your family, who can see it, what we never collect, and how to remove it.",
  privacyUpdated: "Last updated {date}.",
  privacyHoldTitle: "What we hold",
  privacyHoldBody: "Only what a parent types in. Nothing is imported from the school or the district.",
  privacyHoldName: "Your name, and the first name of each child you add.",
  privacyHoldContact: "Any phone number, email or address you choose to add — each one optional.",
  privacyHoldPhoto: "A photo, if you upload one.",
  privacyHoldChild: "The classroom you tell us your child is in.",
  privacyHoldAddress:
    "If you add a street address, we turn it into map coordinates so the optional neighbours feature can work. Those coordinates never leave our server and are never shown to anyone.",
  privacyDefaultTitle: "Private is the default",
  privacyDefaultBody:
    "Every contact detail starts private and stays private until you change it. Each one carries its own setting — visible to members, shared with a specific group, or private — so you can be listed without being reachable. There is no setting that makes anything public, anywhere in the site.",
  privacyChildrenTitle: "Children",
  privacyChildrenBody:
    "A child has no account and cannot sign in. Everything about a child is entered and controlled by their own parent, who can change or remove it at any time. Today no child in this directory has a phone number or an address attached to them.",
  privacyBusTitle: "What we will never collect",
  privacyBusBody:
    "We do not collect and will not collect transportation or bus information — no routes, no stop locations, no pick-up or drop-off times. We also ask for no birthdays, no medical information, no school records and no grades. If that ever needs to change, this page changes first.",
  privacyWhoTitle: "Who can see it",
  privacyWhoBody:
    "Only signed-in members whose account someone has approved. Creating an account is not enough on its own: you tell us who your child is and which classroom they are in, and a person checks before the directory opens. Search engines are told to stay out of every members-only page, and we do not publish the directory anywhere.",
  privacyDeleteTitle: "Removing your family",
  privacyDeleteBody:
    "You can delete anyone you manage from their profile, and it is immediate and permanent — their name, their contact details and their photo all go. You can also ask us and we will do it for you. We keep a dated record that an account acted, because that record is what makes the site accountable, but it holds no contact details.",
  privacyServicesTitle: "Services we rely on",
  privacyServicesBody:
    "A handful of companies handle parts of this on our behalf. Each sees only what its job needs:",
  privacyServiceHosting:
    "Cloudflare — hosting, the database and file storage. Everything here lives on their infrastructure. Cloudflare also counts visits to every page here — which page, the site that linked you, your browser and country — without cookies and without following you to other sites.",
  privacyServiceEmail:
    "Cloudflare Email — delivers our email, so it handles the address a message is sent to and what the message says.",
  privacyServiceMaps:
    "OpenStreetMap — if you add an address, it is sent once to turn into coordinates. Map pictures are fetched by our server, by map square rather than by address, so your browser never asks anyone else for them.",
  privacyServiceStore:
    "Stripe and Printful — only if you buy something from the shop, and only the name and shipping address you type at checkout. A shop order is never linked to a directory profile.",
  privacyServiceTranslate:
    "Google Translate — offered on newsletter pages that are already public. Nothing members-only is ever sent to it.",
  privacyServiceAdmin:
    "Slack — a private channel the site's administrator uses receives a notice, including the email address, when someone new signs up.",
  privacyServiceAi:
    "Cloudflare Workers AI — describes lost & found photos so they can be searched, and, when a newsletter editor asks, suggests edits to a newsletter draft. Only those photos and drafts are sent to it, never anything from the directory.",
  privacyServiceFonts:
    "Typography.com (Hoefler&Co) — supplies the typeface on the game-night bingo board. Your browser fetches the font files from them directly, so they see that request (your IP address and browser), nothing from the directory.",
  privacyLostFoundTitle:
    "Lost & found",
  privacyLostFoundBody:
    "The lost & found is the one part of this site that is public by design: staff and signed-in members photograph items turned in at school, and anyone can browse them. A name written on an item is shown only to staff, never on the public page or in its search; other writing, like a brand, can appear in the description so items stay easy to find. An item with any writing on it — and every item a member adds — stays hidden until a staff member has checked the photo. If you say an item is yours, the name, contact and note you type are seen only by staff, and are deleted 60 days after your request is settled. A returned item and its photo are deleted after 30 days.",
  landingLfBody:
    "Everything turned in at school, with a photo. Search for what's missing and tell the office it's yours.",
  landingLfMore:
    "No account needed.",
  faqLostFoundTitle:
    "Lost something at school?",
  faqLostFoundBody:
    "Staff photograph what's turned in and post it on the lost & found site — and with a directory account, you can add something you found yourself. Anyone can look, and you can tell the office an item is yours without an account. Names written on items are never shown publicly.",
  privacyNeverTitle: "What we don't do",
  privacyNeverBody:
    "We do not sell or share this information, we run no advertising, and nothing here tracks you: the only measurement is the cookie-free visit count described above, which records pages, not people. Nobody is profiled and nothing is sent to a data broker.",
  privacyContactTitle: "Questions",
  privacyContactBody:
    "Write to us and a person will answer. If you think something here is wrong, or you want your family removed, that is the address to use.",
  landingSchoolSiteLabel: "Looking for the school itself?",
  landingSchoolSiteLink: "Eisenhower Elementary website",

  landingHelpEyebrow: "Good to know",
  landingHelpTitle: "Who to call, and where to look",
  landingContactsDistrict: "District contacts",
  landingResourcesTitle: "Where to look",
  landingFactHours: "School hours",
  landingFactOffice: "School office",
  landingFactOfficeBody: "The school itself, immersion program included.",
  landingFactInterpreters: "Interpreters and translation",
  landingFactInterpretersBody:
    "The district offers interpreters and translated documents for families whose first language is not English. Ask the Eisenhower Community Center.",
  landingDeptAthletics: "Athletics",
  landingDeptCommunityEd: "Community Education",
  landingDeptEarlyChildhood: "Early Childhood",
  landingDeptEarlyChildhoodScreening: "Early Childhood Screening",
  landingDeptHumanResources: "Human Resources",
  landingDeptSchoolAgeCare: "School-age care (Kids & Company)",
  landingDeptNutrition: "Nutrition",
  landingDeptSpecialServices: "Special Services",
  landingDeptSuperintendent: "Superintendent",
  landingDeptTransportation: "Transportation",
  landingFactEnroll: "Enrollment",
  landingFactEnrollBody:
    "Every incoming kindergartner must submit a form — Hopkins residents, younger siblings and preschoolers included.",
  landingFactPortal: "Parent portal",
  landingFactPortalBody:
    "Attendance, schedule, fees and grades live in Infinite Campus. Ask here if you need an account, and check that your contact details are current.",
  landingFactBuses: "Buses",
  landingFactBusesBody:
    "Route and stop times arrive by email before the year starts, and are in the parent portal after that. Questions go to {email}.",
  landingFactMeals: "Breakfast and lunch",
  landingFactMealsBody:
    "Free for every student every school day; seconds and extras are charged to their account. Filing for educational benefits still matters — it unlocks fee reductions and summer grocery help.",
  landingFactSafety: "Safety",
  landingFactSafetyBody:
    "The drills every Minnesota school runs, plus how closings and early dismissals are announced.",
  landingFactRoyalReport: "District newsletter",
  landingFactRoyalReportBody:
    "The Royal Report, emailed every two weeks during the school year. Separate from ours, and worth both.",

  offlineBanner: "Offline — showing your saved copy",
  offlineReadOnly: "Read-only",
  offlineNote:
    "You're offline, so the directory is read-only. Your saved copy is shown. Reconnect to make changes.",
  masqViewingAs: "Viewing as",
  masqReturn: "Return to admin",
  signOut: "Sign out",

  brandSubStore: "Store",
  navStore: "Store",
  storeTitle: "School store",
  storeLead: "Spirit wear, printed to order. Every purchase supports the PTO.",
  storeEmpty: "Nothing's for sale just yet — check back soon.",
  storeFrom: "from {price}",
  storeSoldOut: "Sold out",
  storeChooseOption: "Choose a size",
  storeAddToCart: "Add to cart",
  storeCart: "Cart",
  storeCartEmpty: "Your cart is empty.",
  storeKeepShopping: "Keep shopping",
  storeQty: "Qty",
  storeRemove: "Remove",
  storeSubtotal: "Subtotal",
  storeShipping: "Shipping",
  storeTotal: "Total",
  storeWhereTo: "Where should it go?",
  storeFullName: "Full name",
  storeEmail: "Email",
  storeAddress1: "Street address",
  storeAddress2: "Apartment, suite (optional)",
  storeCity: "City",
  storeState: "State",
  storePostalCode: "ZIP code",
  storeCountry: "Country",
  storePhone: "Phone (optional)",
  storeGetShipping: "Get shipping options",
  storeChooseShipping: "Choose shipping",
  storeCheckout: "Checkout",
  storeCheckoutNote: "You'll pay securely on Stripe. We never see your card.",
  storeOrderTitle: "Your order",
  storeOrderProcessing: "We've got it — it's being made.",
  storeOrderShipped: "On its way.",
  storeOrderProblem: "Something needs a hand.",
  storeOrderProblemNote:
    "Your payment went through, but this order needs a person to look at it. We've been told, and we'll be in touch.",
  storeTracking: "Tracking",
  storeOrderNotFound: "We couldn't find that order.",
  storeShipTo: "Shipping to",
  storePlaced: "Placed",
  storeMadeToOrder: "It's printed to order, so give it a few days before it ships.",
  landingStoreBody: "Eisenhower spirit wear — tees, hoodies and more, printed to order and shipped to your door.",
  landingStoreMore: "Every purchase supports the PTO. No account needed to buy.",

  // pto
  brandSubPto: "PTO",
  navPto: "PTO",
  ptoTitle: "The Parent Teacher Organization",
  ptoLead:
    "Every Eisenhower family is already a member. The PTO raises the money the school budget doesn't stretch to, runs the events your kids remember, and looks after the staff who look after them.",
  ptoWhatTitle: "What the PTO does",
  ptoWhatBody:
    "Eisenhower is three schools under one roof — the community school, XinXing Chinese immersion and Juntos Spanish immersion — and the PTO serves all three. It is run entirely by parent and staff volunteers. There is no paid position and no office; everything below is somebody's evening.",
  ptoPillarFund: "Raises money",
  ptoPillarFundBody:
    "The Read-A-Thon, the book fairs, the spring plant sale, Popcorn Fridays and Give to the Max Day. What they bring in pays for field trips, classroom supplies, the outdoor learning space, and enrichment nothing else covers.",
  ptoPillarCommunity: "Brings families together",
  ptoPillarCommunityBody:
    "Playground Night, Field Day, the Talent Show, the Imagination Fair, Bingo Night. Free or close to it, open to everyone, and the reason a family new in August knows a few faces by October.",
  ptoPillarCulture: "Celebrates all three programs",
  ptoPillarCultureBody:
    "Chinese New Year, the Juntos gala and end-of-year fiesta, and the Spring Arts & Cultural Festival. Bingo numbers are called in English, Spanish and Chinese, by parents, every year.",
  ptoPillarStaff: "Backs the staff",
  ptoPillarStaffBody:
    "Meals through the long conference days, Teacher Appreciation Week, a stocked staff lounge, and the Art Adventure and BRAVO lessons parents deliver in the classrooms each winter.",
  ptoBoardTitle: "Who runs it",
  ptoBoardLead:
    "An elected board of parent volunteers, plus whoever raises a hand. Seats are voted on every October, so this page names the jobs rather than the people — the names are in the directory, where they stay current.",
  ptoRolePresident: "President",
  ptoRolePresidentBody:
    "Runs the meetings, coordinates the events, approves reimbursements, books the buses and the vendors, runs the election, and speaks for the PTO to the district.",
  ptoRoleVicePresident: "Vice President",
  ptoRoleVicePresidentBody:
    "Co-leads, and owns the book fair, the Read-A-Thon, the yearbook, teacher appreciation and the staff lounge.",
  ptoRoleSecretary: "Secretary",
  ptoRoleSecretaryBody:
    "Minutes, the monthly PTO Corner newsletter, flyers, wishlists, and getting photos of the year taken and shared.",
  ptoRoleTreasurer: "Treasurer",
  ptoRoleTreasurerBody:
    "The treasurer's report, the budget, taxes, deposits and reimbursements.",
  ptoRoleFundraising: "Fundraising Chair",
  ptoRoleFundraisingBody:
    "Restaurant nights, the Read-A-Thon, the plant sale and Give to the Max Day.",
  ptoRoleVolunteer: "Volunteer Chair",
  ptoRoleVolunteerBody:
    "All volunteer coordination and sign-ups, merchandise, Bingo Night, and the thank-you at the end of the year.",
  ptoRoleTeacherRep: "Teacher Representative",
  ptoRoleTeacherRepBody:
    "The bridge between the staff room and the PTO — brings classroom needs and grant opportunities to the table.",
  ptoRoleMemberAtLarge: "Members-at-Large",
  ptoRoleMemberAtLargeBody:
    "The bench: flexible hands and per-event chairs, for whatever needs an owner this year.",
  ptoYearTitle: "The year, month by month",
  ptoYearLead:
    "Everything the PTO runs, in the order it happens. Dates move — the calendar always has the current ones.",
  ptoYearRound: "All year, in the background:",
  ptoCatFundraiser: "Fundraiser",
  ptoCatCommunity: "Community",
  ptoCatCultural: "Cultural",
  ptoCatAppreciation: "Appreciation",
  ptoCatEnrichment: "Enrichment",
  ptoCatGovernance: "Meeting",
  ptoMeetingsTitle: "Meetings",
  ptoMeetingsBody:
    "Monthly, usually 6:30pm in the {place}, with a Zoom option. The October meeting holds the board election. Everyone is welcome, nothing is expected of you, and you do not have to say a word.",
  ptoHelpTitle: "Ways to help",
  ptoHelpLead:
    "Nobody is asking for a year of your life. Most of what the PTO needs is two hours, once.",
  ptoHelpMeeting: "Come to a meeting",
  ptoHelpMeetingBody:
    "Once a month, about an hour, and the fastest way to find out what is actually going on.",
  ptoHelpWishlist: "Send something",
  ptoHelpShop: "Buy the shirt",
  ptoHelpShopBody:
    "Spirit wear from the PTO store. Every order supports the school, and you don't need an account.",
  ptoHelpMoreCta: "More ways to help",
  ptoOnThisPage: "On this page",
  ptoHowResourceTitle: "The Resource Center",
  ptoHowResourceLead:
    "When an Eisenhower family hits a hard stretch, the Resource Center is how the school helps — quickly and quietly.",
  ptoHowResourceWhat: "What it buys",
  ptoHowResourceWhatBody:
    "Fresh food, groceries, winter coats and boots, and gift cards for essentials — the things a bad month suddenly needs.",
  ptoHowResourceWho: "How it reaches a family",
  ptoHowResourceWhoBody:
    "School staff see the need first and handle every request personally and confidentially. A short form — or a quiet word — is all it takes, and no list anyone else reads. The PTO's part is keeping it funded.",
  ptoHowResourceVolunteer: "Help run it",
  ptoHowResourceVolunteerBody:
    "Regular volunteers do the shopping and keep the shelves stocked and organized — a couple of hours a week. Every upcoming shift is on the sign-up sheet; pick one that fits.",
  ptoHowResourceGive: "How to give",
  ptoHowResourceGiveBody:
    "Give through the PTO's Square store, or leave cash or a check marked “Resource Center” at the front office.",
  ptoHowResourceNoteTitle: "Need assistance?",
  ptoHowResourceNoteBody:
    "Fill out the assistance form, or call the Resource Center. Nobody at the PTO is told who asked, nothing is owed back, and this is exactly what it is for.",
  ptoHowResourceFormCta: "Assistance form",
  ptoResourceFeaturedTag: "Needed right now",
  ptoResourceFeaturedTitle: "Winter clothing drive",
  ptoResourceFeaturedBody:
    "The Resource Center is collecting winter coats and cool-weather clothing — pants, sweatshirts, and the like — in child and adult sizes alike. Drop donations in the front-office bin marked “WINTER GEAR DRIVE.”",
  ptoResourceDonateTitle: "Ways to donate",
  ptoResourceGiftCards: "Gift cards",
  ptoResourceGiftCardsBody:
    "Gift cards for groceries, gas or clothing let a family put the help exactly where their month needs it. Leave one marked “Resource Center” at the front office, or call to arrange.",
  ptoResourceSquare: "Give dollars",
  ptoResourceSquareBody:
    "A direct dollar donation through the PTO's store goes straight to work — any amount, no account needed. You can also drop off cash or a check marked “Resource Center” at the front office.",
  ptoResourceSquareCta: "Open the PTO store",
  ptoResourceSignupCta: "Pick a shift",
  ptoHowVolunteerOpen: "What needs help right now",
  ptoHowVolunteerRecurring: "The ones that come back every year:",
  ptoHowWishlistTitle: "Teacher wishlists",
  ptoHowWishlistLead:
    "Teachers cover more classroom costs out of pocket than anyone admits. A wishlist takes one of those purchases off their plate: order the thing, and it arrives at school.",
  ptoHowWishlistOpen: "Open the wishlist",
  ptoHowWishlistLounge: "The staff lounge",
  ptoHowWishlistLoungeBody:
    "Coffee, tea and snacks for the people who get there before your kids do. This is the list behind “Stock the Staff Lounge.”",
  ptoHowWishlistArt: "The art room",
  ptoHowWishlistArtBody:
    "The supplies the art room runs through fastest, in the sizes it actually uses.",
  ptoHowWishlistFrcBody:
    "Shelf staples for the Resource Center — food, hygiene products and other everyday essentials, delivered straight to the school.",
  ptoHowWishlistClassTitle: "Classroom lists",
  ptoHowWishlistClassLead:
    "Teachers keep lists of their own, too. Find your child's classroom and order a thing — it ships to the school.",
  ptoHowWishlistFilter: "Filter by teacher or classroom",
  ptoHowWishlistFilterNone: "Nothing matches — try fewer letters.",
  ptoHowWishlistNoteTitle: "Don't see your teacher?",
  ptoHowWishlistNoteBody:
    "Lists are added as teachers share them — in the newsletter, at conferences, or by emailing the PTO.",
  ptoDonateTitle: "Donate",
  ptoDonateLead:
    "The PTO is entirely volunteer-run, so what is given goes back to the school almost undiminished — field trips, classroom supplies, the outdoor learning space, and the enrichment programs.",
  ptoDonateCta: "Give through GiveMN",
  ptoDonateNote:
    "GiveMN is Minnesota's nonprofit giving platform, and where the PTO runs its Give to the Max Day campaign each November. You can give there any day of the year.",
  ptoFindTitle: "Find us",
  ptoFindLead:
    "A question, an idea, or an hour to spare — any of these reaches a real person.",
  ptoOrgTitle: "The nonprofit",
  ptoOrgEin: "EIN (tax ID)",
  ptoOrgNote:
    "The PTO is an independent nonprofit run by parents at the school. Mail reaches it at the school's address, and an employer's matching-gift program will ask for the EIN.",
  ptoNoAccessTitle: "This part is for the PTO board",
  ptoNoAccessBody:
    "The planning boards are where the PTO organizes its events, and they are open to the people on the board's roster. Everything else on this site is open to you.",
  ptoNoAccessNote:
    "If you think you should have access, ask a board member — or come to the next meeting, which is genuinely how most people end up here.",
  landingPtoBody:
    "Who the PTO is, what it runs across the year, and how to lend an hour or give.",
  landingPtoMore:
    "Every family is already a member. Nothing to join, no account needed.",
  landingFrcMore:
    "Asking is confidential, and giving takes a minute. No account needed.",
  // Lost & found (apps/lostandfound). Category and colour names translate the
  // fixed vocabularies LF_CATEGORIES / LF_COLORS for display only — the stored
  // value stays English, since it is what the model and the filters speak.
  navLostFound: "Lost & Found",
  brandSubLostFound: "Lost & Found",
  lfNavBrowse: "Browse",
  lfNavStaff: "Staff",
  lfBrowseTitle: "Lost something?",
  lfBrowseLead: "Everything turned in at school, with a photo. Found yours? Open it and tap “That's mine!”",
  lfLabelTip: "Eisenhower parents have had good luck using these fabric stickers to label their belongings",
  lfItemCountOne: "1 item is waiting for its owner.",
  lfItemCount: "{n} items are waiting for their owners.",
  lfCounts: "{found}, {returned}.",
  lfCountsFoundOne: "1 item found",
  lfCountsFound: "{n} items found",
  lfCountsReturnedOne: "1 returned to its owner",
  lfCountsReturned: "{n} returned to their owners",
  lfSearchPlaceholder: "Try “blue water bottle” or “dinosaur hoodie”",
  lfSearchLabel: "Search found items",
  lfAllCategories: "All categories",
  lfCategoryLabel: "Category",
  lfColorLabel: "Color",
  lfBestMatches: "Best matches for “{q}”",
  lfNoMatches: "No matches. Try fewer words, or clear a filter.",
  lfEmpty: "Nothing here right now.",
  lfShowMore: "Show more",
  lfDescribing: "Being described…",
  lfFoundToday: "Found today",
  lfFoundYesterday: "Found yesterday",
  lfFoundDaysAgo: "Found {n} days ago",
  lfLoadError: "Couldn't load items. Check your connection and try again.",
  lfItemGone: "This item isn't listed any more. It may already be back with its owner.",
  lfBackToAll: "All items",
  lfFactCategory: "Category",
  lfFactColors: "Colors",
  lfFactBrand: "Brand",
  lfFactMaterial: "Material",
  lfFactWhere: "Where it was found",
  lfFactFound: "Found on",
  lfAutoDescribed: "Described automatically from the photo.",
  lfZoomIn: "Zoom in",
  lfZoomOut: "Zoom out",
  lfZoomReset: "Reset",
  lfZoomHint: "Pinch or double-tap the photo to zoom, then drag to look around.",
  lfPendingNote: "We're still writing a description for this item.",
  lfClaimTitle: "Is this yours?",
  lfClaimLead: "Tell the office and they'll set it aside for you.",
  lfClaimCta: "That's mine!",
  lfClaimName: "Your name",
  lfClaimContact: "Email or phone",
  lfClaimChild: "Your child's name (optional)",
  lfClaimTeacher: "Their teacher (optional)",
  lfClaimMessage: "How do you know it's yours? (optional)",
  lfClaimMessageHint: "For example: a dent on the bottom, or a sticker",
  lfClaimSend: "Send to the office",
  lfClaimSending: "Sending…",
  lfClaimThanksTitle: "Thank you!",
  lfClaimThanksBody: "The office has your note and will be in touch. You can also pick it up from the lost and found.",
  lfClaimError: "That didn't send. Check your name and contact, then try again.",
  lfClaimPrivacy: "Only school staff see what you type here.",
  lfClaimContactHint: "An email address is best — we can send you a note automatically when it's returned.",
  lfReturnSubject: "Your lost & found item is on its way: {item}",
  lfReturnBodyClassroom: "Good news — “{item}” from the {school} lost & found has been sent home through your child's classroom.",
  lfReturnBodyOffice: "Good news — “{item}” from the {school} lost & found is waiting for you at the front office.",
  lfReturnBodyFamily: "Good news — “{item}” from the {school} lost & found has been returned to your family.",
  lfReturnClosing: "If it doesn't turn up, or this doesn't sound right, contact the {school} office.",
  lfReturnItemFallback: "the item you claimed",
  lfStaffEdit: "Edit this item",
  lfSignInToAdd: "Found something? Sign in to add it",
  lfNavSubmit: "Add item",
  lfSubmitTitle: "Add a found item",
  lfSubmitLead: "Found something at school? Snap a photo — one item per photo, nothing but the item in the frame — and send it in. The office checks every item before it appears here.",
  lfSubmitLocation: "Where did you find it? (optional)",
  lfSubmitLocationHint: "Applies to every photo in this batch.",
  lfSubmitPlaceholder: "e.g. Gym, playground, cafeteria",
  lfSubmitChoose: "Take or choose photos",
  lfSubmitAddMore: "Add more photos",
  lfSubmitChooseHint: "Pick several at once, or snap one after another. Tap ↻ on any that came out sideways.",
  lfSubmitNotice: "Turn names and labels away from the camera — the office reviews every item before it goes public.",
  lfSubmitOne: "Submit 1 item",
  lfSubmitMany: "Submit {n} items",
  lfSubmitClear: "Clear",
  lfSubmitPreparing: "Preparing {n}…",
  lfSubmitWaiting: "Waiting to upload…",
  lfSubmitUploading: "Uploading…",
  lfSubmitDone: "Sent — the office will review it before it appears.",
  lfSubmitFailed: "Upload failed. Check the connection and try again.",
  lfSubmitReadError: "This browser can't read “{name}”. Try taking it with the camera instead.",
  lfSubmitRotateError: "Couldn't rotate “{name}”.",
  lfNoAccessTitle: "This part is for school staff",
  lfNoAccessBody: "Handling claims and publishing items is for the staff who run the lost and found. Browsing is open to everyone, and any signed-in member can add something they found.",
  lfNoAccessNote: "If you help with the lost and found and can't get in, ask the school office.",
  lfCatWaterBottle: "Water bottle",
  lfCatLunchBox: "Lunch box",
  lfCatJacket: "Jacket or coat",
  lfCatSweatshirt: "Sweatshirt or hoodie",
  lfCatClothing: "Clothing (other)",
  lfCatWinterWear: "Hat, gloves, or scarf",
  lfCatShoes: "Shoes or boots",
  lfCatBag: "Backpack or bag",
  lfCatElectronics: "Electronics",
  lfCatGlasses: "Glasses",
  lfCatJewelry: "Jewelry or accessory",
  lfCatToy: "Toy",
  lfCatSchoolSupplies: "Book or school supplies",
  lfCatSports: "Sports equipment",
  lfCatOther: "Other",
  lfColorBlack: "black",
  lfColorWhite: "white",
  lfColorGray: "gray",
  lfColorSilver: "silver",
  lfColorRed: "red",
  lfColorPink: "pink",
  lfColorOrange: "orange",
  lfColorYellow: "yellow",
  lfColorGold: "gold",
  lfColorGreen: "green",
  lfColorBlue: "blue",
  lfColorNavy: "navy",
  lfColorPurple: "purple",
  lfColorBrown: "brown",
  lfColorTan: "tan",
  lfColorMulticolor: "multicolor",

  bingoViewOnly: "Watching — sign in to run the board",
  bingoSignInTitle: "Sign in to run the board",
  bingoSyncError: "Offline — the board will catch up when the connection returns.",

  bingoScanTitle: "Card check",
  bingoScanAlign: "Fit the card inside the frame and hold the phone flat",
  bingoScanReading: "Reading the card — hold steady ({done}/{total})",
  bingoScanBingo: "BINGO — this card wins!",
  bingoScanClean: "Every covered square was called. No bingo yet.",
  bingoScanFalseMarks: "Covered but never called: {nums}",
  bingoScanMissed: "Called but not covered: {nums}",
  bingoScanCamera: "Camera unavailable — allow camera access and try again.",
  bingoScanPhoto: "Check from a photo",
  bingoScanFixHint: "Tap a square to fix a misread number.",
  bingoScanNext: "Next card",
};

const es: Strings = {
  ...en,
  photoOwnFamilyHint: "Por favor, sube solo una foto de tu propia familia, no de los hijos de otras personas.",
  myChildren: "Mis hijos",
  addMyChild: "Agregar a mi hijo/a",
  inThisClass: "En esta clase",
  movesFrom: "Actualmente en {name}: esto lo cambiará.",
  notInAClass: "Todavía no está en una clase",
  noStudentsToPlace: "Ninguno de sus hijos está registrado como estudiante todavía.",
  classPlacementNote: "Un niño está en una clase a la vez. Puede cambiarlo cuando esté equivocado.",
  classPlacementFailed: "No se pudo cambiar su clase. Inténtelo de nuevo.",
  brandSub: "Directorio de la PTO",
  brandSubCalendar: "Calendario de la PTO",
  done: "Listo",
  save: "Guardar",
  cancel: "Cancelar",
  back: "Volver a iniciar sesión",

  signInTitle: "Inicia sesión en el directorio",
  signInCta: "Iniciar sesión",
  signInLead:
    "Escribe tu correo y te enviaremos un enlace para entrar. Sin contraseña que recordar.",
  emailLabel: "Correo",
  emailLink: "Enviarme un enlace",
  privateNote: "Privado para la comunidad de {school}. Nada aquí es público.",
  checkEmailTitle: "Revisa tu correo",
  checkEmailLead:
    "Enviamos un enlace de acceso a {email}. Caduca en 15 minutos.",
  openEmailApp: "Abrir el correo",
  resendLink: "Reenviar enlace",
  signingIn: "Iniciando sesión…",
  signingInSub: "Un momento mientras abrimos el directorio.",
  regClosedTitle: "Gracias — revisa tu correo",
  regClosedLead:
    "Si este correo pertenece a un miembro de {school}, el enlace va en camino.",
  regClosedNote:
    "Por la privacidad de todos, no confirmamos si existe una cuenta. La oficina gestiona los nuevos registros.",

  navHome: "Inicio",
  navDir: "Directorio",
  navGroups: "Grupos",
  navMe: "Tú",
  navAdmin: "Admin",
  navMetrics: "Métricas",
  navBoards: "Tableros",
  navApps: "Apps",
  navAppsLead: "El resto del sitio. Una sola cuenta funciona en todas partes.",
  searchMembers: "Buscar miembros",
  searchGroups: "Buscar grupos",
  myGroups: "Tus grupos",
  allGroups: "Todos los grupos",
  aboutGroupsTitle: "¿Qué es un grupo?",
  aboutGroupsBody:
    "Los grupos organizan la comunidad. Una Familia es tu hogar; un Aula es la clase de un docente. Las escuelas también pueden usar grupos para un Grado, toda la Escuela, o clubes y comités. Una persona puede pertenecer a varios grupos a la vez.",
  whatAreGroups: "¿Qué son los grupos?",
  colName: "Nombre",
  colType: "Tipo",
  groupsResults: "Resultados",
  groupsEmpty: "Ningún grupo coincide con tu búsqueda.",
  directoryEmpty: "Ningún miembro coincide con tu búsqueda.",
  filterByRole: "Filtrar por rol",
  filterAllRoles: "Todos",
  filterByType: "Filtrar por tipo",
  filterAllTypes: "Todos los tipos",
  loadMore: "Cargar más",
  showingOf: "Mostrando {shown} de {total}",

  navCalendar: "Calendarios",
  calendarTitle: "Calendario",
  upcomingEvents: "Próximos eventos",
  noEvents: "No hay eventos próximos",
  searchEvents: "Buscar eventos",
  clearSearch: "Borrar la búsqueda",
  noEventsMatch: "Ningún evento coincide con tu búsqueda.",
  allDay: "Todo el día",
  calendars: "Calendarios",
  calendarsHint:
    "Selecciona un calendario para ocultar sus eventos y vuelve a seleccionarlo para mostrarlos. El + lo agrega a la aplicación de calendario que ya usas, así las fechas nuevas y los cambios llegan solos.",
  calendarsHintOne:
    "El + agrega este calendario a la aplicación que ya usas, así las fechas nuevas y los cambios llegan solos.",
  hintDismiss: "Cerrar",
  downloadIcs: "Descargar {name} (.ics)",
  downloadIcsNote:
    "Una copia única de las fechas de hoy. No se actualizará cuando cambien los planes de la escuela.",
  subscribeIcs: "Suscribirse a {name}",
  subscribeLead:
    "Agrega {name} a la aplicación de calendario que ya usas. Los eventos nuevos y los cambios llegan solos: no tendrás que volver aquí.",
  subscribeApple: "Apple Calendar u Outlook",
  subscribeGoogle: "Google Calendar",
  subscribeOther: "O pega este enlace en cualquier aplicación de calendario",
  subscribeCopy: "Copiar enlace",
  subscribeCopied: "Copiado",
  subscribeNote:
    "Las aplicaciones de calendario buscan actualizaciones por su cuenta, así que un cambio puede tardar unas horas en aparecer.",
  eventTitle: "Evento",
  eventNotFound: "No se encontró el evento",
  eventNotFoundBody:
    "Puede que el evento se haya cambiado o retirado. En el calendario está lo que viene.",
  eventJoinOnline: "Unirse en línea",

  brandSubNewsletter: "Boletín de la PTO",
  navNewsletter: "Boletines",
  newsletterArchive: "Números anteriores",
  newsletterPrefsTitle: "Boletín",
  newsletterPrefsLead: "Elija si desea recibir el boletín escolar en su correo electrónico.",
  newsletterSubscribeLabel: "Enviarme el boletín por correo",
  newsletterSubscribed: "Está suscrito.",
  newsletterUnsubscribed: "No recibirá el boletín.",
  unsubscribeTitle: "Cancelar la suscripción",
  unsubscribeLead: "¿Dejar de enviar el boletín a {email}?",
  unsubscribeConfirm: "Sí, cancelar mi suscripción",
  unsubscribeDone: "Se ha cancelado su suscripción.",
  latestIssue: "Último boletín",

  volunteersTitle: "Voluntarios",
  volunteersNeeded: "Se necesitan voluntarios",
  volunteerSpotsFilled: "{filled} de {slots} cubiertos",
  volunteerSpotsLeft: "Faltan {left}",
  volunteerFull: "Completo",
  takeASpot: "Apuntarme",
  signInToVolunteer: "Inicia sesión para ser voluntario",
  volunteerWithdraw: "Ceder mi lugar",
  volunteerWhoFor: "¿Quién se apunta?",
  volunteerPersonSignedUp: "Ya en la lista",
  volunteerNote: "Nota (opcional)",
  volunteerNeedPerson:
    "Agrégate a ti o a un familiar primero y luego podrás apuntarlo a un puesto.",
  volunteerNotePlaceholder: "Algo que deba saber quien organiza",
  volunteerSignupsClosed: "Las inscripciones están cerradas.",
  volunteerNoPositions: "Todavía no se han publicado puestos.",
  volunteerRunbook: "Cómo se organiza este evento",
  eventAlbum: "Álbum de fotos",
  navAlbums: "Fotos",
  albumsTitle: "Álbumes de fotos de eventos",
  albumsEmpty: "Aún no hay álbumes. Cuando la PTO comparta uno para un evento, aparecerá aquí.",
  volunteerNamesMembersOnly: "Inicia sesión para ver quién se ha apuntado.",
  volunteerAlready: "Ya está apuntado en este puesto.",
  volunteerTookLastSpot: "Alguien acaba de tomar el último lugar.",
  volunteerError: "No se pudo completar. Inténtalo de nuevo.",
  volunteerNotFound: "No se encontró la hoja de inscripción",
  volunteerNotFoundBody: "Puede que el enlace haya caducado o que se hayan retirado las inscripciones.",
  volunteerEntryPrefix: "Voluntariado",
  volunteerAddToCalendar: "Añadir al calendario",
  volunteerAddGoogle: "Google Calendar",
  volunteerAddIcs: "Apple, Outlook y otros (.ics)",
  volunteerSignedUpTitle: "¡Ya tienes tu lugar!",
  volunteerSignedUpBody: "Añádelo a tu calendario para no olvidarlo. Si la escuela cambia el evento, la entrada del calendario enlaza aquí con los datos más recientes.",
  volunteersPageLead: "Próximos eventos que todavía necesitan ayuda. Abre uno para ver los turnos y apuntarte.",
  volunteersPageNone: "Por ahora no se necesitan voluntarios: todos los puestos están cubiertos. Vuelve a mirar pronto.",

  neighbors: "Vecinos",
  noNeighbors: "Aún no hay vecinos cerca.",
  noNeighborsBody:
    "Los vecinos aparecen cuando otros miembros a menos de 2 millas activan la opción para mostrarse como vecinos en su dirección. Tu propia Familia no aparece aquí.",
  seeAll: "Ver todos",
  groups: "Tus grupos",
  member: "Miembro",
  connect: "Conectar",
  connected: "Conectado",
  preview: "Vista previa",
  whatYouShare: "Lo que compartes",
  membersN: "Miembros",
  privateN: "Privado",
  sharedN: "Compartido",
  shownAsNeighbor: "Visible como vecino",
  on: "Activo",
  off: "Inactivo",
  welcome: "Bienvenido a {school}",

  editProfile: "Editar perfil",
  previewingAsMember: "Vista de un miembro",
  whatOthersSee: "Esto es lo que ven otros miembros",
  hiddenFromMembers: "{count} oculto(s) para los miembros",
  unlistedSection: "Aparición en el directorio",
  unlistedOn: "Fuera de la lista. Oculto del directorio, la búsqueda, las listas de grupos y los vecinos de otros miembros; sigue visible para los administradores y para quien gestiona este perfil.",
  unlistedOff: "Aparece con normalidad, como cualquier otro miembro.",
  unlistedRemove: "Quitar del directorio",
  unlistedRestore: "Restaurar en el directorio",
  accessPendingTitle: "Estamos revisando su solicitud",
  accessPendingBody:
    "Alguien de la PTO está revisando lo que usted escribió. Suele ser rápido. Podrá ver el directorio en cuanto se apruebe.",
  accessDeclinedTitle: "No pudimos verificar su solicitud",
  accessDeclinedBody:
    "No pudimos relacionar lo que escribió con una familia de la escuela. Si algo está mal o falta —un nombre mal escrito, el salón equivocado— corríjalo abajo y vuelva a solicitarlo.",
  accessFormTitle: "Solicitar acceso al directorio",
  accessFormLead:
    "El directorio contiene nombres y datos de contacto de otras familias, así que verificamos que cada cuenta pertenezca a una familia de la escuela antes de abrirlo. Díganos quién es usted y quién es su hijo o hija, y lo revisaremos.",
  accessNeedName: "Agregue su nombre y apellido",
  accessNeedStudent: "Agregue al menos un hijo o hija",
  accessNeedClassroom: "Elija el salón de su hijo o hija",
  accessOrStaff: "O, si usted trabaja en la escuela",
  accessNeedStaff: "Márquese como maestro o personal, y díganos abajo qué salón o qué puesto",
  accessNoteLabel: "¿Algo más que debamos saber? (opcional)",
  accessNotePlaceholder: "p. ej.: empezamos en enero, o mi hijo usa otro nombre",
  accessSubmit: "Solicitar acceso",
  accessSubmitFailed: "No se pudo enviar. Revise los pasos de arriba e inténtelo de nuevo.",
  accessSubmitted: "Solicitud enviada",
  accessMeanwhile:
    "Mientras tanto puede usar el calendario, apuntarse como voluntario, leer el boletín y administrar a su propia familia.",
  accessNeedContact: "Agregue al menos una forma de contactar a su familia: un teléfono, correo o dirección",
  accessContactTitle: "Agregue su información de contacto",
  accessContactBody:
    "Falta un paso. El directorio funciona en ambos sentidos: las familias comparten cómo contactarse. Agregue al menos un teléfono, correo o dirección a su perfil y el directorio se abrirá.",
  unlistedBadge: "No listado",
  exitPreview: "Salir",
  contact: "Contacto",
  saveContact: "Guardar contacto",
  fromGroup: "vía {name}",
  shareCta: "Comparte tu información con {name}",
  typeAddress: "Dirección",
  typePhone: "Teléfono",
  homeLabel: "Dirección de casa",
  mobile: "Móvil",
  email: "Correo",
  website: "Sitio web",
  exactHidden: "Dirección exacta oculta",

  visMembers: "Miembros",
  visPrivate: "Privado",
  visShared: "Compartido",

  household: "Familia",
  classroom: "Aula",
  genericGroup: "Grupo",
  genericGroupSub: "Escuela, grado, club o comité",
  genericManages: "{name} gestiona este grupo.",
  createSubgroup: "Crear subgrupo",
  subgroups: "Subgrupos",
  parentGroup: "Grupo principal",
  setParentGroup: "Establecer grupo principal",
  parentNone: "Sin grupo principal (nivel superior)",
  noEligibleGroups: "No hay grupos elegibles.",
  editGroup: "Editar grupo",
  renameGroup: "Cambiar nombre",
  deleteGroup: "Eliminar grupo",
  deleteGroupConfirm: "¿Eliminar «{name}»?",
  deleteGroupWarn: "Esta acción no se puede deshacer.",
  deleteGroupKeepsPeople: "Las {count} personas del grupo permanecen en el directorio: solo se elimina el grupo y la información de contacto que comparte.",
  deleteGroupHasChildren: "Primero mueve o elimina sus subgrupos.",
  deleteGroupFailed: "No se pudo eliminar este grupo.",
  renameGroupFailed: "No se pudo cambiar el nombre de este grupo.",
  groupType: "Tipo",
  groupTypeChangeNote: "El tipo define lo que hace el grupo. Solo una familia comparte una dirección con sus miembros y aparece en la búsqueda de vecinos.",
  changeTypeFailed: "No se pudo cambiar el tipo de este grupo.",
  changeTypeHasChildren: "Una familia no puede contener subgrupos: muévelos primero.",
  reparentFailed: "No se pudo mover este grupo.",
  reparentRejected: "Ese grupo no puede ser el principal: elige otro.",
  confirmDelete: "Sí, eliminar",
  systemAdmin: "Administrador del sistema",
  groupAdminRole: "Administrador del grupo",
  noOneToAdd: "No queda nadie por agregar.",
  removeFromGroup: "Quitar del grupo",
  removeMemberConfirm: "¿Quitar a {name} de este grupo?",
  removeMemberKeepsPerson: "Seguirá en el directorio y en los demás grupos a los que pertenezca.",
  removeMemberLastAdmin: "Primero nombra administrador a otra persona.",
  removeMemberFailed: "No se pudo quitar a esta persona del grupo.",
  confirmRemove: "Sí, quitar",
  appErrorTitle: "Esta pantalla dejó de funcionar",
  appErrorBody: "Algo falló de nuestro lado. Recargar suele solucionarlo; no se envió nada de lo que escribiste.",
  appErrorReload: "Recargar",
  members: "Miembros",
  manage: "Gestionar",

  capParent: "Padre/Madre",
  capTeacher: "Docente",
  capStaff: "Personal",
  capStudent: "Estudiante",
  capHouseholdAdmin: "Administrador del hogar",

  actingAs: "Actuando como",
  addPerson: "Agregar una persona",

  addPersonTitle: "Agregar una persona",

  // Onboarding: la bienvenida y el segundo paso, donde se agrega a la familia.
  setupTitle: "Crea tu perfil",
  setupLead: "Agrega tu nombre para que tu comunidad te reconozca en el directorio.",
  createProfileBtn: "Crear mi perfil",
  skipToAdmin: "Ir a la consola de administración",
  welcomeFamilyTitle: "¿Quién más vive contigo?",
  welcomeFamilyLead:
    "Agrega a tus hijos y a tu pareja para que tu familia aparezca junta. Siempre puedes hacerlo más tarde.",
  welcomeAddChild: "Agregar un hijo",
  welcomeAddPartner: "Agregar a mi pareja",
  welcomeChildHeading: "Tu hijo o hija",
  welcomePartnerHeading: "Tu pareja",
  welcomeAddSubmit: "Agregar",
  welcomeAddedLabel: "Agregados hasta ahora: {count}",
  inviteFailed: "No pudimos enviar la invitación. Revisa el correo e inténtalo de nuevo.",
  welcomeSkip: "Ahora no",
  welcomeContinue: "Continuar",
  welcomeNameError: "No pudimos crear tu perfil. Inténtalo de nuevo.",
  welcomeAddError: "No pudimos agregarla. Inténtalo de nuevo.",
  welcomeDoneTitle: "Todo listo",
  welcomeDoneLead:
    "Tu familia ya está en el directorio. Puedes agregar más personas cuando quieras desde Grupos.",
  welcomeDoneCta: "Ir al directorio",
  welcomePartnerEmail: "Su correo (opcional)",
  welcomePartnerEmailNote:
    "Le enviaremos un enlace para que administre su propio perfil.",
  welcomeInviteFailed:
    "Agregamos a {name}, pero no se pudo enviar la invitación. Puedes invitarla más tarde desde su perfil.",
  welcomeExistingLabel: "Ya están en tu hogar",
  welcomeExistingNote: "Alguien de tu familia ya agregó a estas personas. No hace falta agregarlas otra vez.",
  welcomeExistingLead:
    "Tu familia ya está aquí, agregada por quien configuró esto. Agrega a quien falte.",
  welcomeInviteFamily: "Que pueda administrar todo nuestro hogar",
  welcomeInviteFamilyNote:
    "Podrá ver y editar a todos los del hogar, así no tiene que agregar a la familia de nuevo.",
  removePerson: "Quitar del directorio",
  removePersonTitle: "¿Quitar a {name}?",
  removePersonBody:
    "Esto elimina de forma permanente a {name} y todo lo de su perfil. No se puede deshacer.",
  removePersonConfirm: "Sí, quitar permanentemente",
  removePersonCounts: "Se eliminarán {contacts} datos de contacto y {groups} membresías de grupo.",
  removePersonSignups: "Se cancelarán {count} inscripciones de voluntariado.",
  removePersonEmptied: "{name} es la última persona de su hogar, así que el hogar también se elimina.",
  removePersonShared:
    "Otra persona también administra a {name}, así que no es solo tuya para quitarla. Pídele que deje de administrar a {name} primero.",
  removePersonHouseholdAdmin:
    "{name} es la única persona que administra un hogar que todavía tiene otros miembros. Agrega otra allí primero.",
  removePersonError: "No se pudo quitar. Inténtalo de nuevo.",
  householdAutoName: "Familia {lastName}",
  householdAutoNameFallback: "Familia de {firstName}",
  noGroups: "Todavía no estás en ningún grupo",
  noGroupsBody:
    "Crea tu familia para agregar a las personas con las que vives. Las clases las agrega un maestro o la oficina.",
  noGroupsCta: "Crear mi familia",
  addFamilyTitle: "Agrega a tu familia",
  addFamilyBody:
    "Agrega a tus hijos y a tu pareja para que tu familia aparezca junta en el directorio.",
  addFamilyCta: "Agregar familia",
  addFamilyDismiss: "Quizás después",
  addPersonLead: "Agrega a un hijo, pareja u otra persona que gestiones. Podrás actuar como ella para editar su perfil.",
  addPersonBtn: "Agregar persona",
  personType: "Tipo",
  personTypeNote: "Opcional. Puedes cambiarlo más tarde.",
  personTypeEditNote: "Se muestra como etiquetas junto al nombre en el directorio.",
  personHousehold: "Familia",
  personHouseholdNote: "Opcional. La agrega a una familia para aplicar su dirección compartida.",
  householdNone: "Sin familia",

  language: "Idioma",
  languageNote: "Cambia el directorio solo para ti.",

  footerFeedback: "Comentarios a {email}",

  landingWelcome: "Bienvenidos",
  landingTitle: "{school} — directorio, calendario y boletín",
  landingDescription:
    "El directorio, el calendario, el boletín y las inscripciones de voluntarios para las familias de {school} en {city}. Disponible en {languages}.",
  landingLead:
    "Todo lo que {school} reúne para las familias, en un solo lugar: un directorio de quién es quién, el calendario escolar y el boletín. Una sola cuenta abre los tres.",
  landingReadIn: "Leer esta página en {language}",
  landingCreateAccount: "Crea tu cuenta",
  landingNoPassword: "Sin contraseña que recordar: te enviamos un enlace por correo.",
  landingSeeCalendar: "Ver el calendario",
  landingWhatsHere: "Qué hay aquí",
  landingMembersOnly: "Solo para miembros",
  landingOpenToAll: "Abierto a todos",
  landingOpen: "Abrir {name}",
  landingDirBody:
    "Busca a la familia de un compañero de clase, a un maestro o a quien organiza la actividad en la que te apuntaste. Cada dato que agregas empieza como privado, y tú decides campo por campo quién puede verlo.",
  landingDirMore:
    "{feature}: actívalo y verás qué familias miembros viven cerca de ti: un nombre y una distancia aproximada, nunca una dirección.",
  landingCalBody:
    "Conciertos, conferencias, días de campo, menús del almuerzo, días sin clases. Suscríbete una vez y el año escolar se mantiene al día en la aplicación de calendario que ya usas.",
  landingCalMore: "{feature}: apúntate a un evento desde su propia página.",
  landingNewsTitle: "Boletín",
  landingNewsBody:
    "Noticias de la PTO en tu correo cada pocas semanas: lo que viene, lo que ya se hizo y dónde hacen falta manos.",
  landingNewsMore:
    "Cualquiera puede suscribirse, y todos los números anteriores están en la web. No hace falta cuenta.",
  landingJoinTitle: "Únete al directorio",
  landingJoinBody:
    "Toma un par de minutos. Nada de esto es público: el directorio está cerrado a cualquiera fuera de la comunidad de {school}, y tú eliges qué ve el resto.",
  faqTitle: "Cómo funciona",
  faqPrintTitle: "Sitio web de {school}",
  faqDescription:
    "Lo que {school} mantiene en línea para las familias de {city} — el directorio, el calendario, las inscripciones de voluntarios y el boletín —, cómo crear una cuenta y quién puede ver qué. Disponible en {languages}.",
  faqLead:
    "Todo lo que {school} guarda para las familias está aquí: quién es quién, qué viene y en qué hacen falta manos. Una sola cuenta lo abre todo, y no hay contraseña que recordar: le enviamos un enlace de acceso por correo.",
  faqNav: "Cómo funciona",
  faqVolunteerTitle: "Inscripciones de voluntarios",
  faqVolunteerBody:
    "Cada página de evento muestra qué lugares siguen libres, y cualquiera puede ver cuántos quedan. Apuntarse requiere una cuenta, para que la PTO sepa a quién esperar.",
  faqGetInTitle: "Cómo entrar",
  faqStep1Title: "Entre en {host}",
  faqStep1Body: "Elija {action}.",
  faqStep2Title: "Escriba su correo electrónico",
  faqStep2Body: "Ese es todo el formulario. Nunca pedimos contraseña, porque no existe.",
  faqStep3Title: "Abra el enlace que le enviamos",
  faqStep3Body:
    "Llega en uno o dos minutos y vale por quince. Volver a entrar más adelante funciona igual.",
  faqFamilyTitle: "Después, agregue a su familia.",
  faqFamilyBody:
    "La configuración le pregunta quién más vive en su casa para que su familia aparezca junta: sus hijos y su pareja, que recibe su propio acceso y puede administrar la misma familia. También puede hacerlo más tarde; nada queda fijo.",
  faqApprovalTitle: "Revisamos antes de abrir el directorio",
  faqApprovalBody:
    "Como el directorio contiene nombres y datos de contacto de otras familias, alguien de la PTO verifica que cada cuenta nueva pertenezca a una familia de la escuela: usted nos dice quién es su hijo o hija y en qué salón está, y lo revisamos. Suele ser rápido. Mientras espera ya puede usar el calendario, apuntarse como voluntario y leer el boletín.",
  faqPrivacyTitle: "Quién ve qué: usted decide, dato por dato",
  faqNoPublicLead: "No hay una cuarta opción.",
  faqNoPublicBody:
    "Nada del directorio es público jamás. Está cerrado a todo el que esté fuera de la comunidad de {school}, y a los buscadores se les pide que no entren. Su teléfono, su correo y su dirección llevan cada uno su propia opción, así que puede ser localizable sin ser contactable, o al revés.",
  faqKnowTitle: "Conviene saber",
  faqAddressTitle: "Su dirección sigue siendo suya",
  faqAddressBody:
    "Los demás miembros nunca ven la dirección exacta que usted escribe, solo el hogar al que pertenece. Fuera del directorio no la ve nadie.",
  faqNeighborsTitle: "Vecinos es voluntario",
  faqNeighborsBody:
    "Active \u201Cmuéstrenme como vecino\u201D en una dirección y las familias miembros a menos de dos millas podrán encontrarle: un nombre y una distancia aproximada, nunca una dirección. Si lo deja apagado, sencillamente no aparece.",
  faqUnlistedTitle: "Puede salir del listado",
  faqUnlistedBody:
    "Si prefiere no aparecer, escríbanos y sacamos a su familia del directorio. Conserva su cuenta, el calendario y el boletín.",
  privacyTitle: "Privacidad",
  privacyNav: "Privacidad",
  privacyLead:
    "{school} mantiene este sitio para las familias de la escuela. Esta página explica qué guarda, quién puede verlo y qué nunca recopilaremos. Está escrita para leerse, no para aceptarse.",
  privacyDescription:
    "Qué guarda el directorio de {school} sobre su familia, quién puede verlo, qué nunca recopilamos y cómo eliminarlo.",
  privacyUpdated: "Última actualización: {date}.",
  privacyHoldTitle: "Qué guardamos",
  privacyHoldBody: "Solo lo que escribe un padre o una madre. No importamos nada de la escuela ni del distrito.",
  privacyHoldName: "Su nombre y el nombre de pila de cada hijo o hija que agregue.",
  privacyHoldContact: "El teléfono, correo o dirección que decida agregar: cada uno es opcional.",
  privacyHoldPhoto: "Una foto, si sube alguna.",
  privacyHoldChild: "El salón en el que nos dice que está su hijo o hija.",
  privacyHoldAddress:
    "Si agrega una dirección, la convertimos en coordenadas de mapa para que funcione la función opcional de vecinos. Esas coordenadas nunca salen de nuestro servidor y no se le muestran a nadie.",
  privacyDefaultTitle: "Lo privado es lo predeterminado",
  privacyDefaultBody:
    "Cada dato de contacto empieza siendo privado y sigue siéndolo hasta que usted lo cambie. Cada uno tiene su propia opción —visible para los miembros, compartido con un grupo concreto o privado— para que pueda aparecer sin ser localizable. No existe ninguna opción que haga algo público en ninguna parte del sitio.",
  privacyChildrenTitle: "Los niños",
  privacyChildrenBody:
    "Un niño no tiene cuenta y no puede iniciar sesión. Todo lo relativo a un niño lo introduce y lo controla su propio padre o madre, que puede cambiarlo o eliminarlo en cualquier momento. Hoy ningún niño de este directorio tiene un teléfono ni una dirección asociados.",
  privacyBusTitle: "Lo que nunca recopilaremos",
  privacyBusBody:
    "No recopilamos ni recopilaremos información de transporte ni de autobuses: ni rutas, ni paradas, ni horas de recogida o entrega. Tampoco pedimos fechas de nacimiento, información médica, expedientes escolares ni calificaciones. Si eso alguna vez tuviera que cambiar, esta página cambiaría primero.",
  privacyWhoTitle: "Quién puede verlo",
  privacyWhoBody:
    "Solo los miembros que han iniciado sesión y cuya cuenta alguien ha aprobado. Crear una cuenta no basta por sí solo: usted nos dice quién es su hijo o hija y en qué salón está, y una persona lo revisa antes de abrir el directorio. A los buscadores se les indica que no entren en ninguna página para miembros, y no publicamos el directorio en ningún sitio.",
  privacyDeleteTitle: "Eliminar a su familia",
  privacyDeleteBody:
    "Puede eliminar desde su perfil a cualquier persona que usted administre; es inmediato y permanente, y desaparecen su nombre, sus datos de contacto y su foto. También puede pedírnoslo y lo hacemos nosotros. Conservamos un registro fechado de que una cuenta actuó, porque ese registro es lo que hace que el sitio rinda cuentas, pero no contiene datos de contacto.",
  privacyServicesTitle: "Servicios que utilizamos",
  privacyServicesBody:
    "Unas pocas empresas se encargan de partes de esto en nuestro nombre. Cada una ve solo lo que su función necesita:",
  privacyServiceHosting:
    "Cloudflare: alojamiento, base de datos y almacenamiento de archivos. Todo lo de aquí vive en su infraestructura. Cloudflare también cuenta las visitas a todas las páginas de aquí (qué página, el sitio que le trajo, su navegador y su país) sin cookies y sin seguirle a otros sitios.",
  privacyServiceEmail:
    "Cloudflare Email: entrega nuestro correo, así que maneja la dirección a la que se envía un mensaje y lo que dice el mensaje.",
  privacyServiceMaps:
    "OpenStreetMap: si agrega una dirección, se envía una vez para convertirla en coordenadas. Las imágenes de mapa las obtiene nuestro servidor, por cuadrícula y no por dirección, así que su navegador nunca se las pide a nadie más.",
  privacyServiceStore:
    "Stripe y Printful: solo si compra algo en la tienda, y solo el nombre y la dirección de envío que escriba al pagar. Un pedido nunca se vincula a un perfil del directorio.",
  privacyServiceTranslate:
    "Google Traductor: se ofrece en páginas del boletín que ya son públicas. Nunca se le envía nada que sea solo para miembros.",
  privacyServiceAdmin:
    "Slack: un canal privado que usa el administrador del sitio recibe un aviso, con la dirección de correo, cuando alguien nuevo se registra.",
  privacyServiceAi:
    "Cloudflare Workers AI: describe las fotos de objetos perdidos para que se puedan buscar y, cuando una editora del boletín lo pide, sugiere cambios a un borrador del boletín. Solo recibe esas fotos y borradores, nunca nada del directorio.",
  privacyServiceFonts:
    "Typography.com (Hoefler&Co): suministra la tipografía del tablero de bingo de la noche de juegos. Tu navegador descarga los archivos de la fuente directamente de ellos, así que ven esa solicitud (tu dirección IP y tu navegador), nada del directorio.",
  privacyLostFoundTitle:
    "Objetos perdidos",
  privacyLostFoundBody:
    "Objetos perdidos es la única parte de este sitio que es pública a propósito: el personal y los miembros con sesión iniciada fotografían los objetos que se entregan en la escuela y cualquiera puede verlos. Un nombre escrito en un objeto solo lo ve el personal; nunca aparece en la página pública ni en su búsqueda. Otro texto, como una marca, puede aparecer en la descripción para que los objetos sean fáciles de encontrar. Un objeto con algo escrito —y todo objeto agregado por un miembro— queda oculto hasta que alguien del personal revisa la foto. Si dice que un objeto es suyo, el nombre, el contacto y la nota que escriba solo los ve el personal, y se borran 60 días después de resolverse su solicitud. Un objeto devuelto y su foto se borran a los 30 días.",
  landingLfBody:
    "Todo lo que se entrega en la escuela, con foto. Busque lo que le falta y avise a la oficina de que es suyo.",
  landingLfMore:
    "No hace falta cuenta.",
  faqLostFoundTitle:
    "¿Perdió algo en la escuela?",
  faqLostFoundBody:
    "El personal fotografía lo que se entrega y lo publica en el sitio de objetos perdidos — y con una cuenta del directorio, usted también puede agregar algo que encontró. Cualquiera puede mirar, y puede avisar a la oficina de que un objeto es suyo sin tener cuenta. Los nombres escritos en los objetos nunca se muestran en público.",
  privacyNeverTitle: "Lo que no hacemos",
  privacyNeverBody:
    "No vendemos ni compartimos esta información, no mostramos publicidad y nada aquí le rastrea: la única medición es el conteo de visitas sin cookies descrito arriba, que registra páginas, no personas. No se crean perfiles de nadie y no se envía nada a intermediarios de datos.",
  privacyContactTitle: "Preguntas",
  privacyContactBody:
    "Escríbanos y le responderá una persona. Si cree que algo de aquí está mal, o quiere que eliminemos a su familia, esa es la dirección.",
  landingSchoolSiteLabel: "¿Buscas la escuela?",
  landingSchoolSiteLink: "Sitio web de Eisenhower Elementary",

  landingHelpEyebrow: "Bueno saberlo",
  landingHelpTitle: "A quién llamar y dónde buscar",
  landingContactsDistrict: "Contactos del distrito",
  landingResourcesTitle: "Dónde buscar",
  landingFactHours: "Horario escolar",
  landingFactOffice: "Oficina de la escuela",
  landingFactOfficeBody: "La escuela misma, incluido el programa de inmersión.",
  landingFactInterpreters: "Intérpretes y traducción",
  landingFactInterpretersBody:
    "El distrito ofrece intérpretes y documentos traducidos para las familias cuyo primer idioma no es el inglés. Pregunta en el Eisenhower Community Center.",
  landingDeptAthletics: "Deportes",
  landingDeptCommunityEd: "Educación Comunitaria",
  landingDeptEarlyChildhood: "Primera Infancia",
  landingDeptEarlyChildhoodScreening: "Evaluación de Primera Infancia",
  landingDeptHumanResources: "Recursos Humanos",
  landingDeptSchoolAgeCare: "Cuidado después de clases (Kids & Company)",
  landingDeptNutrition: "Nutrición",
  landingDeptSpecialServices: "Servicios Especiales",
  landingDeptSuperintendent: "Superintendente",
  landingDeptTransportation: "Transporte",
  landingFactEnroll: "Inscripción",
  landingFactEnrollBody:
    "Todo niño que empieza kínder debe entregar un formulario, incluidos los residentes de Hopkins, los hermanos menores y los de preescolar.",
  landingFactPortal: "Portal para padres",
  landingFactPortalBody:
    "La asistencia, el horario, las cuotas y las notas están en Infinite Campus. Pide aquí una cuenta si no la tienes, y comprueba que tus datos de contacto estén al día.",
  landingFactBuses: "Autobuses",
  landingFactBusesBody:
    "Las rutas y las horas de parada llegan por correo antes de empezar el año, y después están en el portal para padres. Las dudas van a {email}.",
  landingFactMeals: "Desayuno y almuerzo",
  landingFactMealsBody:
    "Gratis para cada estudiante todos los días de clase; las repeticiones y los extras se cobran a su cuenta. Aun así conviene solicitar los beneficios educativos: dan descuentos en cuotas y ayuda con la compra en verano.",
  landingFactSafety: "Seguridad",
  landingFactSafetyBody:
    "Los simulacros que hace toda escuela de Minnesota, y cómo se anuncian los cierres y las salidas anticipadas.",
  landingFactRoyalReport: "Boletín del distrito",
  landingFactRoyalReportBody:
    "El Royal Report, enviado por correo cada dos semanas durante el año escolar. Es aparte del nuestro, y vale la pena recibir ambos.",

  offlineBanner: "Sin conexión — mostrando tu copia guardada",
  offlineReadOnly: "Solo lectura",
  offlineNote:
    "Estás sin conexión, así que el directorio es de solo lectura. Se muestra tu copia guardada. Reconéctate para hacer cambios.",
  masqViewingAs: "Viendo como",
  masqReturn: "Volver a admin",
  signOut: "Cerrar sesión",

  brandSubStore: "Tienda",
  navStore: "Tienda",
  storeTitle: "Tienda escolar",
  storeLead: "Ropa escolar, impresa por encargo. Cada compra apoya a la PTO.",
  storeEmpty: "Todavía no hay nada a la venta — vuelve pronto.",
  storeFrom: "desde {price}",
  storeSoldOut: "Agotado",
  storeChooseOption: "Elige una talla",
  storeAddToCart: "Añadir al carrito",
  storeCart: "Carrito",
  storeCartEmpty: "Tu carrito está vacío.",
  storeKeepShopping: "Seguir comprando",
  storeQty: "Cant.",
  storeRemove: "Quitar",
  storeSubtotal: "Subtotal",
  storeShipping: "Envío",
  storeTotal: "Total",
  storeWhereTo: "¿A dónde lo enviamos?",
  storeFullName: "Nombre completo",
  storeEmail: "Correo electrónico",
  storeAddress1: "Dirección",
  storeAddress2: "Apartamento, suite (opcional)",
  storeCity: "Ciudad",
  storeState: "Estado",
  storePostalCode: "Código postal",
  storeCountry: "País",
  storePhone: "Teléfono (opcional)",
  storeGetShipping: "Ver opciones de envío",
  storeChooseShipping: "Elige el envío",
  storeCheckout: "Pagar",
  storeCheckoutNote: "Pagarás de forma segura en Stripe. Nunca vemos tu tarjeta.",
  storeOrderTitle: "Tu pedido",
  storeOrderProcessing: "Lo recibimos — se está preparando.",
  storeOrderShipped: "En camino.",
  storeOrderProblem: "Algo necesita atención.",
  storeOrderProblemNote:
    "Tu pago se procesó, pero este pedido necesita que alguien lo revise. Ya nos avisaron y te contactaremos.",
  storeTracking: "Seguimiento",
  storeOrderNotFound: "No encontramos ese pedido.",
  storeShipTo: "Enviar a",
  storePlaced: "Realizado",
  storeMadeToOrder: "Se imprime por encargo, así que tardará unos días en enviarse.",
  landingStoreBody: "Ropa escolar de Eisenhower — camisetas, sudaderas y más, impresas por encargo y enviadas a tu casa.",
  landingStoreMore: "Cada compra apoya a la PTO. No necesitas cuenta para comprar.",

  // pto
  brandSubPto: "PTO",
  navPto: "PTO",
  ptoTitle: "La Organización de Padres y Maestros",
  ptoLead:
    "Cada familia de Eisenhower ya es miembro. La PTO reúne el dinero que el presupuesto escolar no alcanza a cubrir, organiza los eventos que sus hijos recuerdan, y cuida al personal que los cuida a ellos.",
  ptoWhatTitle: "Qué hace la PTO",
  ptoWhatBody:
    "Eisenhower son tres escuelas bajo un mismo techo — la escuela comunitaria, la inmersión en chino XinXing y la inmersión en español Juntos — y la PTO sirve a las tres. La llevan por completo padres y personal voluntarios. No hay ningún puesto pagado ni oficina; todo lo que sigue es la tarde de alguien.",
  ptoPillarFund: "Reúne fondos",
  ptoPillarFundBody:
    "El Read-A-Thon, las ferias del libro, la venta de plantas de primavera, los viernes de palomitas y el Give to the Max Day. Lo que se recauda paga excursiones, materiales para las aulas, el espacio de aprendizaje al aire libre y programas que nada más cubre.",
  ptoPillarCommunity: "Une a las familias",
  ptoPillarCommunityBody:
    "La Noche del Patio, el Día de Campo, el Show de Talentos, la Feria de la Imaginación, la Noche de Bingo. Gratis o casi, abiertos a todos, y la razón por la que una familia nueva en agosto ya conoce algunas caras en octubre.",
  ptoPillarCulture: "Celebra los tres programas",
  ptoPillarCultureBody:
    "El Año Nuevo Chino, la gala de Juntos y la fiesta de fin de año, y el Festival de Arte y Cultura de primavera. Los números del bingo se cantan en inglés, español y chino, por padres de familia, todos los años.",
  ptoPillarStaff: "Apoya al personal",
  ptoPillarStaffBody:
    "Comidas durante los largos días de conferencias, la Semana de Agradecimiento a los Maestros, una sala de personal bien surtida, y las clases de Art Adventure y BRAVO que los padres dan en las aulas cada invierno.",
  ptoBoardTitle: "Quién la dirige",
  ptoBoardLead:
    "Una junta electa de padres voluntarios, más quien levante la mano. Los puestos se votan cada octubre, así que esta página nombra los cargos y no a las personas — los nombres están en el directorio, donde se mantienen al día.",
  ptoRolePresident: "Presidencia",
  ptoRolePresidentBody:
    "Dirige las reuniones, coordina los eventos, aprueba los reembolsos, contrata autobuses y proveedores, organiza la elección y representa a la PTO ante el distrito.",
  ptoRoleVicePresident: "Vicepresidencia",
  ptoRoleVicePresidentBody:
    "Co-dirige, y se encarga de la feria del libro, el Read-A-Thon, el anuario, el agradecimiento a los maestros y la sala de personal.",
  ptoRoleSecretary: "Secretaría",
  ptoRoleSecretaryBody:
    "Las actas, el boletín mensual PTO Corner, los volantes, las listas de deseos, y hacer que las fotos del año se tomen y se compartan.",
  ptoRoleTreasurer: "Tesorería",
  ptoRoleTreasurerBody:
    "El informe de tesorería, el presupuesto, los impuestos, los depósitos y los reembolsos.",
  ptoRoleFundraising: "Coordinación de recaudación",
  ptoRoleFundraisingBody:
    "Las noches en restaurantes, el Read-A-Thon, la venta de plantas y el Give to the Max Day.",
  ptoRoleVolunteer: "Coordinación de voluntarios",
  ptoRoleVolunteerBody:
    "Toda la coordinación e inscripción de voluntarios, la mercancía, la Noche de Bingo y el agradecimiento de fin de año.",
  ptoRoleTeacherRep: "Representación docente",
  ptoRoleTeacherRepBody:
    "El puente entre la sala de maestros y la PTO — lleva a la mesa las necesidades del aula y las oportunidades de subvención.",
  ptoRoleMemberAtLarge: "Vocales",
  ptoRoleMemberAtLargeBody:
    "La banca: manos flexibles y responsables de un evento, para lo que este año necesite dueño.",
  ptoYearTitle: "El año, mes a mes",
  ptoYearLead:
    "Todo lo que organiza la PTO, en el orden en que ocurre. Las fechas cambian — el calendario siempre tiene las actuales.",
  ptoYearRound: "Todo el año, de fondo:",
  ptoCatFundraiser: "Recaudación",
  ptoCatCommunity: "Comunidad",
  ptoCatCultural: "Cultural",
  ptoCatAppreciation: "Agradecimiento",
  ptoCatEnrichment: "Enriquecimiento",
  ptoCatGovernance: "Reunión",
  ptoMeetingsTitle: "Reuniones",
  ptoMeetingsBody:
    "Cada mes, normalmente a las 6:30 p. m. en el {place}, con opción por Zoom. En la reunión de octubre se elige la junta. Todos son bienvenidos, no se espera nada de usted, y no tiene que decir ni una palabra.",
  ptoHelpTitle: "Maneras de ayudar",
  ptoHelpLead:
    "Nadie le está pidiendo un año de su vida. Casi todo lo que la PTO necesita son dos horas, una vez.",
  ptoHelpMeeting: "Venga a una reunión",
  ptoHelpMeetingBody:
    "Una vez al mes, más o menos una hora, y la forma más rápida de enterarse de lo que realmente pasa.",
  ptoHelpWishlist: "Mande algo",
  ptoHelpShop: "Compre la camiseta",
  ptoHelpShopBody:
    "Ropa escolar de la tienda de la PTO. Cada pedido apoya a la escuela, y no necesita cuenta.",
  ptoHelpMoreCta: "Más maneras de ayudar",
  ptoOnThisPage: "En esta página",
  ptoHowResourceTitle: "El Centro de Recursos",
  ptoHowResourceLead:
    "Cuando una familia de Eisenhower pasa por un momento difícil, el Centro de Recursos es la forma en que la escuela ayuda — rápido y con discreción.",
  ptoHowResourceWhat: "En qué se gasta",
  ptoHowResourceWhatBody:
    "Comida fresca, despensa, abrigos y botas de invierno, y tarjetas de regalo para lo esencial — lo que un mal mes de repente necesita.",
  ptoHowResourceWho: "Cómo llega a una familia",
  ptoHowResourceWhoBody:
    "El personal de la escuela ve la necesidad primero y atiende cada caso de manera personal y confidencial. Basta un formulario corto — o una palabra discreta — y no hay ninguna lista que otros lean. La parte de la PTO es que nunca falten fondos.",
  ptoHowResourceVolunteer: "Ayude a mantenerlo",
  ptoHowResourceVolunteerBody:
    "Voluntarios regulares hacen las compras y mantienen los estantes surtidos y ordenados — un par de horas por semana. Todos los turnos próximos están en la hoja de inscripción; elija el que le quede bien.",
  ptoHowResourceGive: "Cómo donar",
  ptoHowResourceGiveBody:
    "Done a través de la tienda Square de la PTO, o deje efectivo o un cheque marcado «Resource Center» en la oficina de la escuela.",
  ptoHowResourceNoteTitle: "¿Necesita ayuda?",
  ptoHowResourceNoteBody:
    "Complete el formulario de solicitud de apoyo, o llame al Centro de Recursos. Nadie en la PTO sabrá quién pidió ayuda, no se debe nada a cambio, y esto existe exactamente para eso.",
  ptoHowResourceFormCta: "Formulario de solicitud de apoyo",
  ptoResourceFeaturedTag: "Lo que se necesita ahora",
  ptoResourceFeaturedTitle: "Colecta de ropa de invierno",
  ptoResourceFeaturedBody:
    "El Centro de Recursos está reuniendo abrigos de invierno y ropa para el frío — pantalones, sudaderas y similares — en tallas de niño y de adulto por igual. Deje su donación en el contenedor de la oficina de la escuela marcado «WINTER GEAR DRIVE».",
  ptoResourceDonateTitle: "Maneras de donar",
  ptoResourceGiftCards: "Tarjetas de regalo",
  ptoResourceGiftCardsBody:
    "Una tarjeta de regalo para despensa, gasolina o ropa permite que una familia use la ayuda exactamente donde su mes la necesita. Deje una marcada «Resource Center» en la oficina de la escuela, o llame para coordinar.",
  ptoResourceSquare: "Done en efectivo",
  ptoResourceSquareBody:
    "Una donación directa en dólares a través de la tienda de la PTO se pone a trabajar de inmediato — cualquier monto, sin necesidad de cuenta. También puede dejar efectivo o un cheque marcado «Resource Center» en la oficina de la escuela.",
  ptoResourceSquareCta: "Abrir la tienda de la PTO",
  ptoResourceSignupCta: "Elegir un turno",
  ptoHowVolunteerOpen: "Qué necesita ayuda ahora mismo",
  ptoHowVolunteerRecurring: "Los que vuelven cada año:",
  ptoHowWishlistTitle: "Listas de deseos de los maestros",
  ptoHowWishlistLead:
    "Los maestros cubren de su bolsillo más gastos del aula de lo que cualquiera admite. Una lista de deseos les quita una de esas compras de encima: pida la cosa, y llega a la escuela.",
  ptoHowWishlistOpen: "Abrir la lista",
  ptoHowWishlistLounge: "La sala de personal",
  ptoHowWishlistLoungeBody:
    "Café, té y botanas para las personas que llegan antes que sus hijos. Esta es la lista detrás de «Stock the Staff Lounge».",
  ptoHowWishlistArt: "El salón de arte",
  ptoHowWishlistArtBody:
    "Los materiales que el salón de arte gasta más rápido, en los tamaños que de verdad usa.",
  ptoHowWishlistFrcBody:
    "Lo básico para los estantes del Centro de Recursos — comida, productos de higiene y otras cosas esenciales, entregado directamente a la escuela.",
  ptoHowWishlistClassTitle: "Listas de los salones",
  ptoHowWishlistClassLead:
    "Los maestros también tienen sus propias listas. Busque el salón de su hijo y pida una cosa — llega a la escuela.",
  ptoHowWishlistFilter: "Filtrar por maestro o salón",
  ptoHowWishlistFilterNone: "Nada coincide — pruebe con menos letras.",
  ptoHowWishlistNoteTitle: "¿No ve a su maestro?",
  ptoHowWishlistNoteBody:
    "Las listas se agregan a medida que los maestros las comparten — en el boletín, en las conferencias, o escribiendo a la PTO.",
  ptoDonateTitle: "Donar",
  ptoDonateLead:
    "La PTO funciona enteramente con voluntarios, así que lo que se dona vuelve a la escuela casi intacto — excursiones, materiales para las aulas, el espacio de aprendizaje al aire libre y los programas de enriquecimiento.",
  ptoDonateCta: "Donar a través de GiveMN",
  ptoDonateNote:
    "GiveMN es la plataforma de donaciones sin fines de lucro de Minnesota, y donde la PTO organiza su campaña del Give to the Max Day cada noviembre. Puede donar allí cualquier día del año.",
  ptoFindTitle: "Encuéntrenos",
  ptoFindLead:
    "Una pregunta, una idea, o una hora libre — cualquiera de estos llega a una persona de verdad.",
  ptoOrgTitle: "La organización",
  ptoOrgEin: "EIN (número de identificación fiscal)",
  ptoOrgNote:
    "La PTO es una organización independiente sin fines de lucro dirigida por padres de la escuela. El correo llega a la dirección de la escuela, y el programa de donaciones equivalentes de una empresa le pedirá el EIN.",
  ptoNoAccessTitle: "Esta parte es para la junta de la PTO",
  ptoNoAccessBody:
    "Los tableros de planificación son donde la PTO organiza sus eventos, y están abiertos a las personas de la lista de la junta. Todo lo demás en este sitio está abierto para usted.",
  ptoNoAccessNote:
    "Si cree que debería tener acceso, pregúntele a alguien de la junta — o venga a la próxima reunión, que es de verdad como llega aquí la mayoría.",
  landingPtoBody:
    "Quién es la PTO, qué organiza a lo largo del año, y cómo prestar una hora o donar.",
  landingPtoMore:
    "Cada familia ya es miembro. Nada que firmar, no hace falta cuenta.",
  landingFrcMore:
    "Pedir ayuda es confidencial, y donar toma un minuto. No hace falta cuenta.",
  // Lost & found (apps/lostandfound). Category and colour names translate the
  // fixed vocabularies LF_CATEGORIES / LF_COLORS for display only — the stored
  // value stays English, since it is what the model and the filters speak.
  navLostFound: "Objetos perdidos",
  brandSubLostFound: "Objetos perdidos",
  lfNavBrowse: "Explorar",
  lfNavStaff: "Personal",
  lfBrowseTitle: "¿Perdiste algo?",
  lfBrowseLead: "Todo lo que se ha entregado en la escuela, con foto. ¿Encontraste lo tuyo? Ábrelo y toca «¡Es mío!».",
  lfLabelTip: "A las familias de Eisenhower les han dado buen resultado estas etiquetas de tela para marcar sus pertenencias",
  lfItemCountOne: "1 objeto espera a su dueño.",
  lfItemCount: "{n} objetos esperan a sus dueños.",
  lfCounts: "{found}, {returned}.",
  lfCountsFoundOne: "1 objeto encontrado",
  lfCountsFound: "{n} objetos encontrados",
  lfCountsReturnedOne: "1 devuelto a su dueño",
  lfCountsReturned: "{n} devueltos a sus dueños",
  lfSearchPlaceholder: "Prueba «botella de agua azul» o «sudadera de dinosaurio»",
  lfSearchLabel: "Buscar objetos encontrados",
  lfAllCategories: "Todas las categorías",
  lfCategoryLabel: "Categoría",
  lfColorLabel: "Color",
  lfBestMatches: "Mejores resultados para «{q}»",
  lfNoMatches: "Sin resultados. Prueba con menos palabras o quita un filtro.",
  lfEmpty: "No hay nada por ahora.",
  lfShowMore: "Ver más",
  lfDescribing: "Describiendo…",
  lfFoundToday: "Encontrado hoy",
  lfFoundYesterday: "Encontrado ayer",
  lfFoundDaysAgo: "Encontrado hace {n} días",
  lfLoadError: "No se pudieron cargar los objetos. Revisa tu conexión e inténtalo de nuevo.",
  lfItemGone: "Este objeto ya no está en la lista. Puede que ya haya vuelto con su dueño.",
  lfBackToAll: "Todos los objetos",
  lfFactCategory: "Categoría",
  lfFactColors: "Colores",
  lfFactBrand: "Marca",
  lfFactMaterial: "Material",
  lfFactWhere: "Dónde se encontró",
  lfFactFound: "Fecha",
  lfAutoDescribed: "Descripción generada automáticamente a partir de la foto (en inglés).",
  lfZoomIn: "Acercar",
  lfZoomOut: "Alejar",
  lfZoomReset: "Restablecer",
  lfZoomHint: "Pellizca o toca dos veces la foto para acercar, y arrastra para mirar alrededor.",
  lfPendingNote: "Todavía estamos escribiendo la descripción de este objeto.",
  lfClaimTitle: "¿Es tuyo?",
  lfClaimLead: "Avísale a la oficina y te lo guardarán.",
  lfClaimCta: "¡Es mío!",
  lfClaimName: "Tu nombre",
  lfClaimContact: "Correo electrónico o teléfono",
  lfClaimChild: "El nombre de tu hijo o hija (opcional)",
  lfClaimTeacher: "Su maestro o maestra (opcional)",
  lfClaimMessage: "¿Cómo sabes que es tuyo? (opcional)",
  lfClaimMessageHint: "Por ejemplo: una abolladura abajo o una calcomanía",
  lfClaimSend: "Enviar a la oficina",
  lfClaimSending: "Enviando…",
  lfClaimThanksTitle: "¡Gracias!",
  lfClaimThanksBody: "La oficina recibió tu mensaje y se pondrá en contacto contigo. También puedes recogerlo en objetos perdidos.",
  lfClaimError: "No se pudo enviar. Revisa tu nombre y tu contacto e inténtalo de nuevo.",
  lfClaimPrivacy: "Solo el personal de la escuela ve lo que escribes aquí.",
  lfClaimContactHint: "Un correo electrónico es lo mejor: podemos avisarte automáticamente cuando se devuelva.",
  lfReturnSubject: "Tu objeto perdido va en camino: {item}",
  lfReturnBodyClassroom: "Buenas noticias: “{item}” de objetos perdidos de {school} se envió a casa con tu hijo o hija a través de su salón.",
  lfReturnBodyOffice: "Buenas noticias: “{item}” de objetos perdidos de {school} te espera en la oficina de la escuela.",
  lfReturnBodyFamily: "Buenas noticias: “{item}” de objetos perdidos de {school} se devolvió a tu familia.",
  lfReturnClosing: "Si no aparece, o algo no cuadra, comunícate con la oficina de {school}.",
  lfReturnItemFallback: "el objeto que reclamaste",
  lfStaffEdit: "Editar este objeto",
  lfSignInToAdd: "¿Encontraste algo? Inicia sesión para agregarlo",
  lfNavSubmit: "Agregar",
  lfSubmitTitle: "Agregar un objeto encontrado",
  lfSubmitLead: "¿Encontraste algo en la escuela? Toma una foto —un objeto por foto, solo el objeto en la imagen— y envíala. La oficina revisa cada objeto antes de que aparezca aquí.",
  lfSubmitLocation: "¿Dónde lo encontraste? (opcional)",
  lfSubmitLocationHint: "Se aplica a todas las fotos de este lote.",
  lfSubmitPlaceholder: "p. ej. Gimnasio, patio, cafetería",
  lfSubmitChoose: "Toma o elige fotos",
  lfSubmitAddMore: "Agregar más fotos",
  lfSubmitChooseHint: "Elige varias a la vez o tómalas una tras otra. Toca ↻ en las que salieron de lado.",
  lfSubmitNotice: "Gira los nombres y las etiquetas lejos de la cámara — la oficina revisa cada objeto antes de hacerlo público.",
  lfSubmitOne: "Enviar 1 objeto",
  lfSubmitMany: "Enviar {n} objetos",
  lfSubmitClear: "Borrar",
  lfSubmitPreparing: "Preparando {n}…",
  lfSubmitWaiting: "Esperando para subir…",
  lfSubmitUploading: "Subiendo…",
  lfSubmitDone: "Enviado — la oficina lo revisará antes de que aparezca.",
  lfSubmitFailed: "No se pudo subir. Revisa la conexión e intenta de nuevo.",
  lfSubmitReadError: "Este navegador no puede leer “{name}”. Intenta tomarla con la cámara.",
  lfSubmitRotateError: "No se pudo girar “{name}”.",
  lfNoAccessTitle: "Esta parte es para el personal de la escuela",
  lfNoAccessBody: "Atender reclamos y publicar objetos le corresponde al personal que administra objetos perdidos. Cualquiera puede explorar, y cualquier miembro con sesión iniciada puede agregar algo que encontró.",
  lfNoAccessNote: "Si ayudas con objetos perdidos y no puedes entrar, pregunta en la oficina de la escuela.",
  lfCatWaterBottle: "Botella de agua",
  lfCatLunchBox: "Lonchera",
  lfCatJacket: "Chaqueta o abrigo",
  lfCatSweatshirt: "Sudadera",
  lfCatClothing: "Ropa (otra)",
  lfCatWinterWear: "Gorro, guantes o bufanda",
  lfCatShoes: "Zapatos o botas",
  lfCatBag: "Mochila o bolsa",
  lfCatElectronics: "Electrónicos",
  lfCatGlasses: "Lentes",
  lfCatJewelry: "Joyería o accesorio",
  lfCatToy: "Juguete",
  lfCatSchoolSupplies: "Libro o útiles escolares",
  lfCatSports: "Equipo deportivo",
  lfCatOther: "Otro",
  lfColorBlack: "negro",
  lfColorWhite: "blanco",
  lfColorGray: "gris",
  lfColorSilver: "plateado",
  lfColorRed: "rojo",
  lfColorPink: "rosado",
  lfColorOrange: "anaranjado",
  lfColorYellow: "amarillo",
  lfColorGold: "dorado",
  lfColorGreen: "verde",
  lfColorBlue: "azul",
  lfColorNavy: "azul marino",
  lfColorPurple: "morado",
  lfColorBrown: "café",
  lfColorTan: "beige",
  lfColorMulticolor: "multicolor",

  bingoViewOnly: "Solo espectador — inicia sesión para manejar el tablero",
  bingoSignInTitle: "Inicia sesión para manejar el tablero",
  bingoSyncError: "Sin conexión — el tablero se pondrá al día cuando vuelva la conexión.",

  bingoScanTitle: "Revisión de cartones",
  bingoScanAlign: "Encuadra el cartón dentro del marco y mantén el teléfono plano",
  bingoScanReading: "Leyendo el cartón — mantén firme la cámara ({done}/{total})",
  bingoScanBingo: "¡BINGO! Este cartón gana.",
  bingoScanClean: "Todas las casillas cubiertas fueron cantadas. Aún no hay bingo.",
  bingoScanFalseMarks: "Cubiertas pero no cantadas: {nums}",
  bingoScanMissed: "Cantadas pero sin cubrir: {nums}",
  bingoScanCamera: "Cámara no disponible — permite el acceso a la cámara e inténtalo de nuevo.",
  bingoScanPhoto: "Revisar desde una foto",
  bingoScanFixHint: "Toca una casilla para corregir un número mal leído.",
  bingoScanNext: "Siguiente cartón",
};

const zh: Strings = {
  ...en,
  photoOwnFamilyHint: "请只上传您自己家人的照片，不要上传别人孩子的照片。",
  myChildren: "我的孩子",
  addMyChild: "添加我的孩子",
  inThisClass: "在此班级",
  movesFrom: "目前在 {name}——此操作会将其转出。",
  notInAClass: "尚未加入班级",
  noStudentsToPlace: "您的孩子尚未设置为学生。",
  classPlacementNote: "每个孩子同时只能在一个班级。如有错误，您可以随时更改。",
  classPlacementFailed: "无法更改其班级。请重试。",
  brandSub: "PTO 名录",
  brandSubCalendar: "PTO 日历",
  done: "完成",
  save: "保存",
  cancel: "取消",
  back: "返回登录",

  signInTitle: "登录目录",
  signInCta: "登录",
  signInLead: "输入你的邮箱，我们会发送登录链接。无需记住密码。",
  emailLabel: "邮箱",
  emailLink: "给我发送链接",
  privateNote: "仅限 {school} 社区可见，这里没有任何内容是公开的。",
  checkEmailTitle: "查看你的邮箱",
  checkEmailLead: "我们已将登录链接发送至 {email}，15 分钟内有效。",
  openEmailApp: "打开邮箱应用",
  resendLink: "重新发送链接",
  signingIn: "正在登录…",
  signingInSub: "正在为你打开目录，请稍候。",
  regClosedTitle: "谢谢 — 请查看你的邮箱",
  regClosedLead: "如果该邮箱属于 {school} 成员，登录链接正在发送中。",
  regClosedNote:
    "为保护每个人的隐私，我们不会确认账户是否存在。新注册由学校办公室管理。",

  navHome: "主页",
  navDir: "目录",
  navGroups: "群组",
  navMe: "我",
  navAdmin: "管理",
  navMetrics: "统计",
  navBoards: "看板",
  navApps: "应用",
  navAppsLead: "网站的其他部分。一个账户，处处通用。",
  searchMembers: "搜索成员",
  searchGroups: "搜索群组",
  myGroups: "你的群组",
  allGroups: "所有群组",
  aboutGroupsTitle: "什么是群组？",
  aboutGroupsBody:
    "群组用于组织社区。家庭即你的家人；班级是某位老师的课堂。学校还可以为年级、整所学校或社团和委员会创建群组。一个人可以同时属于多个群组。",
  whatAreGroups: "什么是群组？",
  colName: "名称",
  colType: "类型",
  groupsResults: "结果",
  groupsEmpty: "没有匹配的群组。",
  directoryEmpty: "没有匹配的成员。",
  filterByRole: "按角色筛选",
  filterAllRoles: "全部",
  filterByType: "按类型筛选",
  filterAllTypes: "所有类型",
  loadMore: "加载更多",
  showingOf: "显示 {shown} / {total}",

  navCalendar: "日历",
  calendarTitle: "日历",
  upcomingEvents: "近期活动",
  noEvents: "暂无近期活动",
  searchEvents: "搜索活动",
  clearSearch: "清除搜索",
  noEventsMatch: "没有符合搜索条件的活动。",
  allDay: "全天",
  calendars: "日历",
  calendarsHint:
    "点选某个日历可隐藏它的活动，再点一次即可恢复。点 + 可把日历添加到你常用的日历应用，新活动和改动会自动同步。",
  calendarsHintOne: "点 + 可把此日历添加到你常用的日历应用，新活动和改动会自动同步。",
  hintDismiss: "关闭",
  downloadIcs: "下载 {name}（.ics）",
  downloadIcsNote: "当前日期的一次性副本。学校安排变动时不会自动更新。",
  subscribeIcs: "订阅{name}",
  subscribeLead: "把{name}添加到你常用的日历应用。新活动和改动会自动同步，你不必再回到这里查看。",
  subscribeApple: "Apple 日历或 Outlook",
  subscribeGoogle: "Google 日历",
  subscribeOther: "或把此链接粘贴到任意日历应用",
  subscribeCopy: "复制链接",
  subscribeCopied: "已复制",
  subscribeNote: "日历应用会按自己的时间检查更新，因此改动可能需要几小时才会显示。",
  eventTitle: "活动",
  eventNotFound: "未找到该活动",
  eventNotFoundBody: "该活动可能已改期或已取消。日历上有近期的安排。",
  eventJoinOnline: "在线参加",

  brandSubNewsletter: "PTO 通讯",
  navNewsletter: "通讯",
  newsletterArchive: "往期通讯",
  newsletterPrefsTitle: "通讯",
  newsletterPrefsLead: "选择是否将学校通讯发送到您的电子邮箱。",
  newsletterSubscribeLabel: "通过电子邮件接收通讯",
  newsletterSubscribed: "您已订阅。",
  newsletterUnsubscribed: "您将不会收到通讯。",
  unsubscribeTitle: "退订",
  unsubscribeLead: "停止向 {email} 发送通讯？",
  unsubscribeConfirm: "是的，为我退订",
  unsubscribeDone: "您已退订。",
  latestIssue: "最新通讯",

  volunteersTitle: "志愿者",
  volunteersNeeded: "招募志愿者",
  volunteerSpotsFilled: "已报名 {filled}/{slots}",
  volunteerSpotsLeft: "还需 {left} 人",
  volunteerFull: "已满",
  takeASpot: "我要报名",
  signInToVolunteer: "登录后即可报名",
  volunteerWithdraw: "取消报名",
  volunteerWhoFor: "为谁报名？",
  volunteerPersonSignedUp: "已报名",
  volunteerNote: "备注（可选）",
  volunteerNeedPerson: "请先添加您本人或一位家庭成员，然后即可为其报名。",
  volunteerNotePlaceholder: "有什么需要组织者知道的",
  volunteerSignupsClosed: "报名已截止。",
  volunteerNoPositions: "尚未发布任何岗位。",
  volunteerRunbook: "活动组织指南",
  eventAlbum: "相册",
  navAlbums: "照片",
  albumsTitle: "活动相册",
  albumsEmpty: "暂无相册。家长会为活动分享相册后，会显示在这里。",
  volunteerNamesMembersOnly: "登录后可查看报名名单。",
  volunteerAlready: "该岗位已报名。",
  volunteerTookLastSpot: "最后一个名额刚被别人报走了。",
  volunteerError: "操作未成功，请重试。",
  volunteerNotFound: "未找到报名表",
  volunteerNotFoundBody: "链接可能已失效，或报名已被撤下。",
  volunteerEntryPrefix: "志愿者",
  volunteerAddToCalendar: "添加到日历",
  volunteerAddGoogle: "Google 日历",
  volunteerAddIcs: "Apple、Outlook 及其他（.ics）",
  volunteerSignedUpTitle: "报名成功",
  volunteerSignedUpBody: "把它加到您的日历里，以免忘记。如果学校调整了活动，日历条目会链接回这里查看最新信息。",
  volunteersPageLead: "以下活动仍需帮手。点开活动即可查看岗位并报名。",
  volunteersPageNone: "目前不需要志愿者——所有名额都已报满。欢迎过段时间再来看看。",

  neighbors: "邻居",
  noNeighbors: "附近暂无邻居。",
  noNeighborsBody:
    "当 2 英里内的其他成员为自己的地址开启邻居显示后，他们就会出现在这里。你自己家庭的成员不会列出。",
  seeAll: "查看全部",
  groups: "你的群组",
  member: "成员",
  connect: "连接",
  connected: "已连接",
  preview: "预览",
  whatYouShare: "你分享的内容",
  membersN: "成员",
  privateN: "私密",
  sharedN: "已分享",
  shownAsNeighbor: "显示为邻居",
  on: "开",
  off: "关",
  welcome: "欢迎来到 {school}",

  editProfile: "编辑资料",
  previewingAsMember: "以成员身份预览",
  whatOthersSee: "这是其他成员看到的内容",
  hiddenFromMembers: "{count} 项对成员隐藏",
  unlistedSection: "名录显示",
  unlistedOn: "已从名单中移除。其他成员的名录、搜索、小组名单和邻居中均不显示；管理员和管理此档案的人仍可看到。",
  unlistedOff: "正常显示，与其他成员一样。",
  unlistedRemove: "从名录中移除",
  unlistedRestore: "恢复到名录",
  accessPendingTitle: "我们正在审核您的申请",
  accessPendingBody:
    "家长会的工作人员正在查看您填写的内容。通常很快就会完成。一经批准，您即可查看名录。",
  accessDeclinedTitle: "我们无法核对您的申请",
  accessDeclinedBody:
    "我们无法将您填写的内容与学校的家庭对应起来。如果有误或缺失——姓名拼写错误、班级选错——请在下方更正后再次申请。",
  accessFormTitle: "申请查看名录",
  accessFormLead:
    "名录中包含其他家庭的姓名和联系方式，因此我们会先确认每个账户属于本校家庭再开放访问。请告诉我们您是谁、您的孩子是谁，我们会尽快查看。",
  accessNeedName: "填写您的姓和名",
  accessNeedStudent: "至少添加一个孩子",
  accessNeedClassroom: "选择您孩子的班级",
  accessOrStaff: "或者，如果您在学校工作",
  accessNeedStaff: "请将自己标记为教师或教职员工，并在下方告诉我们您的教室或职务",
  accessNoteLabel: "还有其他需要说明的吗？（选填）",
  accessNotePlaceholder: "例如：我们一月份入学，或我的孩子使用另一个名字",
  accessSubmit: "申请访问",
  accessSubmitFailed: "提交未成功。请检查上面的步骤后重试。",
  accessSubmitted: "申请已发送",
  accessMeanwhile:
    "在此期间，您仍可使用日历、报名志愿服务、阅读通讯，并管理自己的家庭信息。",
  accessNeedContact: "请至少添加一种联系方式——电话、邮箱或地址",
  accessContactTitle: "添加您的联系方式",
  accessContactBody:
    "还差一步。通讯录是双向的：家庭之间互相分享联系方式。请在您的个人资料中至少添加一个电话、邮箱或地址，通讯录即会开放。",
  unlistedBadge: "未列出",
  exitPreview: "退出",
  contact: "联系方式",
  saveContact: "保存联系人",
  fromGroup: "来自 {name}",
  shareCta: "与 {name} 分享你的信息",
  typeAddress: "地址",
  typePhone: "电话",
  homeLabel: "家庭住址",
  mobile: "手机",
  email: "邮箱",
  website: "网站",
  exactHidden: "已隐藏具体地址",

  visMembers: "成员",
  visPrivate: "私密",
  visShared: "已分享",

  household: "家庭",
  classroom: "班级",
  genericGroup: "群组",
  genericGroupSub: "学校、年级、社团或委员会",
  genericManages: "{name} 管理此群组。",
  createSubgroup: "创建子群组",
  subgroups: "子群组",
  parentGroup: "上级群组",
  setParentGroup: "设置上级群组",
  parentNone: "无上级（顶层）",
  noEligibleGroups: "没有符合条件的群组。",
  editGroup: "编辑群组",
  renameGroup: "重命名",
  deleteGroup: "删除群组",
  deleteGroupConfirm: "确定删除“{name}”？",
  deleteGroupWarn: "此操作无法撤销。",
  deleteGroupKeepsPeople: "群组中的 {count} 人仍保留在通讯录中——只会删除该群组及其共享的联系信息。",
  deleteGroupHasChildren: "请先移动或删除其子群组。",
  deleteGroupFailed: "无法删除此群组。",
  renameGroupFailed: "无法重命名此群组。",
  groupType: "类型",
  groupTypeChangeNote: "类型决定群组的作用。只有家庭会与成员共享地址并出现在邻居发现中。",
  changeTypeFailed: "无法更改此群组的类型。",
  changeTypeHasChildren: "家庭不能包含子群组，请先将其移出。",
  reparentFailed: "无法移动此群组。",
  reparentRejected: "该群组不能作为上级，请选择其他群组。",
  confirmDelete: "确认删除",
  systemAdmin: "系统管理员",
  groupAdminRole: "群组管理员",
  noOneToAdd: "没有可添加的人了。",
  removeFromGroup: "移出群组",
  removeMemberConfirm: "将 {name} 移出该群组？",
  removeMemberKeepsPerson: "该成员仍会保留在通讯录中，以及其所属的其他群组中。",
  removeMemberLastAdmin: "请先指定另一位管理员。",
  removeMemberFailed: "无法将该成员移出群组。",
  confirmRemove: "确认移出",
  appErrorTitle: "此页面已停止运行",
  appErrorBody: "我们这边出了问题。重新加载通常即可解决——您输入的内容并未发送。",
  appErrorReload: "重新加载",
  members: "成员",
  manage: "管理",

  capParent: "家长",
  capTeacher: "老师",
  capStaff: "教职员",
  capStudent: "学生",
  capHouseholdAdmin: "家庭管理员",

  actingAs: "当前身份",
  addPerson: "添加成员",

  addPersonTitle: "添加成员",

  // 新用户引导：欢迎页与第二步（添加家人）。
  setupTitle: "创建你的资料",
  setupLead: "填写你的姓名，让社区在名录中认出你。",
  createProfileBtn: "创建我的资料",
  skipToAdmin: "前往管理后台",
  welcomeFamilyTitle: "家里还有谁？",
  welcomeFamilyLead: "添加你的孩子和配偶，让一家人显示在一起。你也可以稍后再添加。",
  welcomeAddChild: "添加孩子",
  welcomeAddPartner: "添加配偶",
  welcomeChildHeading: "你的孩子",
  welcomePartnerHeading: "你的配偶",
  welcomeAddSubmit: "添加",
  welcomeAddedLabel: "已添加 {count} 人",
  inviteFailed: "邀请发送失败，请检查邮箱地址后重试。",
  welcomeSkip: "暂时跳过",
  welcomeContinue: "继续",
  welcomeNameError: "无法创建你的资料，请重试。",
  welcomeAddError: "无法添加该成员，请重试。",
  welcomeDoneTitle: "全部完成",
  welcomeDoneLead: "你的家庭已加入名录。你可以随时在「群组」中添加更多成员。",
  welcomeDoneCta: "前往名录",
  welcomePartnerEmail: "对方的邮箱（可选）",
  welcomePartnerEmailNote: "我们会给对方发送一个链接，让其自行管理资料。",
  welcomeInviteFailed:
    "已添加 {name}，但邀请邮件发送失败。你可以稍后在其资料页再次邀请。",
  welcomeExistingLabel: "已在你的家庭中",
  welcomeExistingNote: "家里已经有人添加过这些成员，不需要再添加一次。",
  welcomeExistingLead: "你的家人已经在这里了，由设置此账户的人添加。请补充还缺的成员。",
  welcomeInviteFamily: "让对方管理我们整个家庭",
  welcomeInviteFamilyNote: "对方将能查看和编辑家里的所有成员，就不必重新添加家人。",
  removePerson: "从通讯录中移除",
  removePersonTitle: "移除 {name}？",
  removePersonBody: "这将永久删除 {name} 及其资料页上的全部内容，且无法撤销。",
  removePersonConfirm: "确认永久移除",
  removePersonCounts: "将删除 {contacts} 条联系方式和 {groups} 个群组成员身份。",
  removePersonSignups: "将取消 {count} 项志愿者报名。",
  removePersonEmptied: "{name} 是其家庭的最后一名成员，该家庭也将一并删除。",
  removePersonShared: "还有其他人也在管理 {name}，因此不能由你单独移除。请先请对方停止管理 {name}。",
  removePersonHouseholdAdmin: "{name} 是某个仍有其他成员的家庭的唯一管理者。请先在该家庭中添加另一位管理者。",
  removePersonError: "移除失败，请重试。",
  householdAutoName: "{lastName}家",
  householdAutoNameFallback: "{firstName}的家庭",
  noGroups: "你还没有加入任何群组",
  noGroupsBody: "创建你的家庭，把同住的人加进来。班级由老师或校办添加。",
  noGroupsCta: "创建我的家庭",
  addFamilyTitle: "添加家人",
  addFamilyBody: "添加你的孩子和配偶，让一家人在名录中显示在一起。",
  addFamilyCta: "添加家人",
  addFamilyDismiss: "以后再说",
  addPersonLead: "添加孩子、配偶或其他由你管理的人。你可以切换为该成员来编辑其资料。",
  addPersonBtn: "添加成员",
  personType: "类型",
  personTypeNote: "可选。之后可以更改。",
  personTypeEditNote: "在通讯录中显示为姓名旁的标签。",
  personHousehold: "家庭",
  personHouseholdNote: "可选。将其加入某个家庭，以共享该家庭的地址。",
  householdNone: "无家庭",

  language: "语言",
  languageNote: "仅更改你自己的目录显示。",

  footerFeedback: "意见反馈：{email}",

  landingWelcome: "欢迎",
  landingTitle: "{school} — 名录、日历与通讯",
  landingDescription:
    "{school} 为 {city} 的家庭提供的名录、日历、通讯和志愿者报名。提供 {languages} 版本。",
  landingLead:
    "{school} 为家庭准备的一切都在这里：一份「谁是谁」的名录、学校日历，以及通讯。一个账户，三处通用。",
  landingReadIn: "用{language}阅读本页",
  landingCreateAccount: "创建账户",
  landingNoPassword: "无需记住密码，我们会把登录链接发到你的邮箱。",
  landingSeeCalendar: "查看日历",
  landingWhatsHere: "这里有什么",
  landingMembersOnly: "仅限成员",
  landingOpenToAll: "对所有人开放",
  landingOpen: "打开{name}",
  landingDirBody:
    "查找同学的家庭、老师，或某项活动的负责人。你填写的每一项资料默认都是私密的，并且可以逐项决定谁能看到。",
  landingDirMore:
    "{feature}：开启后即可看到住在附近的成员家庭——只显示姓名和大致距离，绝不显示地址。",
  landingCalBody:
    "音乐会、家长会、野餐、午餐菜单、不上课的日子。订阅一次，整个学年都会自动同步到你惯用的日历应用里。",
  landingCalMore: "{feature}：直接在活动页面上报名。",
  landingNewsTitle: "通讯",
  landingNewsBody:
    "每隔几周，PTO 的消息就会送到你的邮箱：即将开始的事、已经完成的事，以及还需要人手的事。",
  landingNewsMore: "任何人都可以订阅，往期通讯也都在网上，无需账户。",
  landingJoinTitle: "加入名录",
  landingJoinBody:
    "只需几分钟。这里没有任何内容是公开的——名录不对 {school} 社区以外的任何人开放，其余内容由你决定谁能看到。",
  faqTitle: "使用说明",
  faqPrintTitle: "{school} 网站",
  faqDescription:
    "{school} 为 {city} 的家庭在线提供的内容——通讯录、日历、志愿者报名和通讯——如何注册账号，以及谁能看到哪些信息。提供 {languages}。",
  faqLead:
    "{school} 为家庭保存的一切都在这里：谁是谁、接下来有什么活动、哪里还缺人手。一个账号即可全部打开，而且无需记住密码——我们会用邮件发送登录链接。",
  faqNav: "使用说明",
  faqVolunteerTitle: "志愿者报名",
  faqVolunteerBody:
    "每个活动页面都会显示还有哪些名额空着，任何人都能看到数量。报名需要账号，这样家长会才知道会有谁来。",
  faqGetInTitle: "如何加入",
  faqStep1Title: "打开 {host}",
  faqStep1Body: "选择{action}。",
  faqStep2Title: "填写您的邮箱",
  faqStep2Body: "整个表格就这一项。我们从不索取密码，因为根本没有密码。",
  faqStep3Title: "点击我们发送的链接",
  faqStep3Body: "一两分钟内送达，十五分钟内有效。以后再次登录也是同样的方式。",
  faqFamilyTitle: "然后添加您的家人。",
  faqFamilyBody:
    "设置时会询问家里还有谁，好让一家人显示在一起——您的孩子，以及您的伴侣，对方会有自己的登录方式，并可管理同一个家庭。也可以以后再补，一切都能改。",
  faqApprovalTitle: "开放名录前我们会先核对",
  faqApprovalBody:
    "由于名录中包含其他家庭的姓名和联系方式，家长会的工作人员会确认每个新账户属于本校家庭——您告诉我们孩子是谁、在哪个班级，我们会查看一下。通常很快。等待期间，您已经可以使用日历、报名志愿服务并阅读通讯。",
  faqPrivacyTitle: "谁能看到什么——由您逐项决定",
  faqNoPublicLead: "没有第四种设置。",
  faqNoPublicBody:
    "通讯录中的内容从不公开。它对 {school} 社区以外的所有人关闭，并且会要求搜索引擎不要收录。您的电话、邮箱和住址各有各的设置，因此您可以让别人找得到您却联系不到，或者反过来。",
  faqKnowTitle: "值得了解",
  faqAddressTitle: "您的住址仍然属于您",
  faqAddressBody:
    "其他成员看不到您填写的详细地址，只能看到它所属的家庭。通讯录之外没有人能看到任何内容。",
  faqNeighborsTitle: "邻居功能需自行开启",
  faqNeighborsBody:
    "为某个地址开启\u201C把我显示为邻居\u201D后，两英里内的成员家庭就能找到您：只有姓名和大致距离，绝不会有街道地址。不开启就完全不会出现。",
  faqUnlistedTitle: "您可以不出现在名册上",
  faqUnlistedBody:
    "如果您宁愿完全不被列出，请写信给我们，我们会把您一家从通讯录中移除。您的账号、日历和通讯都会保留。",
  privacyTitle: "隐私",
  privacyNav: "隐私",
  privacyLead:
    "{school} 为本校家庭运营这个网站。本页说明我们保存哪些信息、谁能看到，以及我们永远不会收集什么。它是写来给您读的，不是让您点同意的。",
  privacyDescription:
    "{school} 通讯录保存您家庭的哪些信息、谁能看到、我们从不收集什么，以及如何删除。",
  privacyUpdated: "最后更新：{date}。",
  privacyHoldTitle: "我们保存什么",
  privacyHoldBody: "只有家长自己填写的内容。我们不从学校或学区导入任何数据。",
  privacyHoldName: "您的姓名，以及您添加的每个孩子的名字。",
  privacyHoldContact: "您选择添加的电话、邮箱或地址——每一项都是可选的。",
  privacyHoldPhoto: "照片，如果您上传的话。",
  privacyHoldChild: "您告诉我们孩子所在的班级。",
  privacyHoldAddress:
    "如果您填写街道地址，我们会将其转换为地图坐标，以便可选的「邻居」功能运作。这些坐标绝不会离开我们的服务器，也绝不会显示给任何人。",
  privacyDefaultTitle: "默认即私密",
  privacyDefaultBody:
    "每一项联系方式默认都是私密的，在您更改之前一直如此。每一项都有自己的设置——对成员可见、与特定群组共享，或保持私密——所以您可以被列出而不被联系。本站任何地方都没有让内容公开的设置。",
  privacyChildrenTitle: "关于孩子",
  privacyChildrenBody:
    "孩子没有账号，也无法登录。关于孩子的一切都由其家长填写和掌控，家长可随时修改或删除。目前本通讯录中没有任何一个孩子附有电话或地址。",
  privacyBusTitle: "我们永远不会收集的内容",
  privacyBusBody:
    "我们不收集、也不会收集交通或校车信息——没有路线、没有站点位置、没有接送时间。我们同样不索取生日、医疗信息、学籍记录或成绩。如果这一点将来需要改变，本页会先改变。",
  privacyWhoTitle: "谁能看到",
  privacyWhoBody:
    "只有已登录、且账户经过审核批准的成员。仅仅注册并不够：您告诉我们孩子是谁、在哪个班级，由人工核对后才会开放通讯录。我们告知搜索引擎不要收录任何仅限成员的页面，也不会在任何地方公开通讯录。",
  privacyDeleteTitle: "删除您的家庭信息",
  privacyDeleteBody:
    "您可以在个人资料中删除任何由您管理的人，删除是立即且永久的——姓名、联系方式和照片都会一并消失。您也可以联系我们代为处理。我们会保留一条带日期的操作记录，因为正是这条记录让本站可被问责，但其中不含任何联系方式。",
  privacyServicesTitle: "我们依赖的服务",
  privacyServicesBody: "有几家公司代我们处理其中一部分工作。每一家只能看到其职责所需的内容：",
  privacyServiceHosting:
    "Cloudflare——托管、数据库与文件存储。这里的一切都运行在他们的基础设施上。Cloudflare 还会统计这里每个页面的访问量（访问了哪个页面、从哪个网站链接过来、浏览器和国家），不使用 Cookie，也不会在其他网站上追踪您。",
  privacyServiceEmail: "Cloudflare Email——负责投递我们的邮件，因此会接触收件地址和邮件内容。",
  privacyServiceMaps:
    "OpenStreetMap——如果您填写地址，它会被发送一次以转换为坐标。地图图片由我们的服务器获取，按地图方格而非按地址，所以您的浏览器不会向第三方请求。",
  privacyServiceStore:
    "Stripe 与 Printful——仅当您在商店购物时，且仅限您结账时填写的姓名和收货地址。订单绝不会与通讯录档案关联。",
  privacyServiceTranslate: "Google 翻译——仅在本已公开的通讯页面上提供。仅限成员的内容绝不会发送给它。",
  privacyServiceAdmin: "Slack——网站管理员使用的一个私人频道，会在有新用户注册时收到通知，其中包含其邮箱地址。",
  privacyServiceAi:
    "Cloudflare Workers AI——为失物招领的照片生成描述以便搜索；在通讯编辑提出请求时，也会对通讯草稿提出修改建议。只会发送这些照片和草稿，绝不会发送目录中的任何内容。",
  privacyServiceFonts:
    "Typography.com (Hoefler&Co)——为游戏之夜宾果板提供字体。您的浏览器会直接从他们那里获取字体文件，因此他们能看到这次请求（您的 IP 地址和浏览器），但看不到目录中的任何内容。",
  privacyLostFoundTitle:
    "失物招领",
  privacyLostFoundBody:
    "失物招领是本网站唯一有意公开的部分：工作人员和已登录的成员会为学校收到的物品拍照，任何人都可以浏览。物品上写的名字只有工作人员能看到，绝不会出现在公开页面或其搜索中；其他文字（例如品牌名）可以出现在描述里，方便大家查找。写有文字的物品，以及成员添加的所有物品，在工作人员检查照片之前都不会公开。如果您认领某件物品，您填写的姓名、联系方式和留言只有工作人员能看到，并会在您的申请处理完毕 60 天后删除。已归还的物品及其照片会在 30 天后删除。",
  landingLfBody:
    "学校收到的所有失物，都附有照片。搜索您丢失的东西，并告诉办公室那是您的。",
  landingLfMore:
    "无需账户。",
  faqLostFoundTitle:
    "在学校丢了东西？",
  faqLostFoundBody:
    "工作人员会为收到的物品拍照，并发布在失物招领网站上——拥有目录账户的您也可以自己添加捡到的物品。任何人都可以查看，无需账户即可告诉办公室某件物品是您的。物品上写的名字绝不会公开显示。",
  privacyNeverTitle: "我们不做的事",
  privacyNeverBody:
    "我们不出售也不共享这些信息，不投放广告，这里也没有任何东西追踪您：唯一的统计就是上面提到的不使用 Cookie 的访问计数，它记录的是页面，而不是人。我们不对任何人建立画像，也不向数据经纪商发送任何内容。",
  privacyContactTitle: "疑问",
  privacyContactBody:
    "写信给我们，会有人回复。如果您认为这里有任何错误，或希望删除您的家庭信息，请使用该邮箱。",
  landingSchoolSiteLabel: "在找学校官网？",
  landingSchoolSiteLink: "Eisenhower Elementary 官网",

  landingHelpEyebrow: "需要知道的事",
  landingHelpTitle: "找谁打电话，去哪里查",
  landingContactsDistrict: "学区各部门",
  landingResourcesTitle: "去哪里查",
  landingFactHours: "上课时间",
  landingFactOffice: "学校办公室",
  landingFactOfficeBody: "学校本身，含沉浸式课程。",
  landingFactInterpreters: "口译与翻译",
  landingFactInterpretersBody:
    "学区为母语非英语的家庭提供口译员和翻译好的文件。请联系 Eisenhower Community Center。",
  landingDeptAthletics: "体育",
  landingDeptCommunityEd: "社区教育",
  landingDeptEarlyChildhood: "幼儿教育",
  landingDeptEarlyChildhoodScreening: "幼儿健康筛查",
  landingDeptHumanResources: "人力资源",
  landingDeptSchoolAgeCare: "课后托管（Kids & Company）",
  landingDeptNutrition: "营养餐",
  landingDeptSpecialServices: "特殊教育服务",
  landingDeptSuperintendent: "学区总监",
  landingDeptTransportation: "交通",
  landingFactEnroll: "入学报名",
  landingFactEnrollBody:
    "所有即将入读幼儿园的孩子都必须提交表格，包括住在 Hopkins 的居民、弟弟妹妹以及读学前班的孩子。",
  landingFactPortal: "家长门户",
  landingFactPortalBody:
    "出勤、课表、费用和成绩都在 Infinite Campus 里。没有账户可以在这里申请，也请顺便核对联系方式是否最新。",
  landingFactBuses: "校车",
  landingFactBusesBody:
    "路线和上下车时间会在开学前通过邮件发送，之后可在家长门户中查看。有问题请联系 {email}。",
  landingFactMeals: "早餐和午餐",
  landingFactMealsBody:
    "每位学生在每个上课日的早餐和午餐都免费；添饭和额外的食品会从学生账户中扣费。仍建议申请教育补助，可减免各项费用并获得暑期食品补贴。",
  landingFactSafety: "安全",
  landingFactSafetyBody: "明尼苏达州所有学校都要进行的演练，以及停课和提前放学的通知方式。",
  landingFactRoyalReport: "学区通讯",
  landingFactRoyalReportBody:
    "Royal Report，学年期间每两周发送一次邮件。与我们的通讯是两回事，两份都值得订阅。",

  offlineBanner: "离线 — 显示你保存的副本",
  offlineReadOnly: "只读",
  offlineNote: "你目前处于离线状态，目录为只读。正在显示你保存的副本。重新连接后即可进行更改。",
  masqViewingAs: "正在查看",
  masqReturn: "返回管理员",
  signOut: "退出登录",

  brandSubStore: "商店",
  navStore: "商店",
  storeTitle: "学校商店",
  storeLead: "校园服饰，按订单印制。每一笔购买都支持家长教师协会。",
  storeEmpty: "暂时还没有商品 — 请稍后再来。",
  storeFrom: "起价 {price}",
  storeSoldOut: "已售罄",
  storeChooseOption: "选择尺码",
  storeAddToCart: "加入购物车",
  storeCart: "购物车",
  storeCartEmpty: "购物车是空的。",
  storeKeepShopping: "继续购物",
  storeQty: "数量",
  storeRemove: "移除",
  storeSubtotal: "小计",
  storeShipping: "运费",
  storeTotal: "合计",
  storeWhereTo: "寄到哪里？",
  storeFullName: "姓名",
  storeEmail: "电子邮箱",
  storeAddress1: "街道地址",
  storeAddress2: "公寓、房间号（选填）",
  storeCity: "城市",
  storeState: "州",
  storePostalCode: "邮政编码",
  storeCountry: "国家",
  storePhone: "电话（选填）",
  storeGetShipping: "查看配送方式",
  storeChooseShipping: "选择配送方式",
  storeCheckout: "结账",
  storeCheckoutNote: "你将在 Stripe 上安全付款。我们不会看到你的卡号。",
  storeOrderTitle: "你的订单",
  storeOrderProcessing: "已收到 — 正在制作中。",
  storeOrderShipped: "已发货。",
  storeOrderProblem: "有一个问题需要处理。",
  storeOrderProblemNote: "你的付款已完成，但这笔订单需要人工处理。我们已收到通知，会与你联系。",
  storeTracking: "物流查询",
  storeOrderNotFound: "找不到该订单。",
  storeShipTo: "寄送至",
  storePlaced: "下单时间",
  storeMadeToOrder: "商品按订单印制，发货前请预留几天时间。",
  landingStoreBody: "Eisenhower 校园服饰 — T恤、卫衣等，按订单印制并直接寄到你家。",
  landingStoreMore: "每一笔购买都支持家长教师协会。无需账户即可购买。",

  // pto
  brandSubPto: "家长教师协会",
  navPto: "家长会",
  ptoTitle: "家长教师协会（PTO）",
  ptoLead:
    "每一个艾森豪威尔小学的家庭都已经是会员。家长会筹集学校预算无法覆盖的经费，举办孩子们记得住的活动，也照顾着照顾孩子的教职员工。",
  ptoWhatTitle: "家长会做什么",
  ptoWhatBody:
    "艾森豪威尔小学是同一屋檐下的三所学校——社区学校、XinXing 中文沉浸式课程和 Juntos 西班牙语沉浸式课程——家长会为三者共同服务。它完全由家长和教职员志愿者运作，没有一个带薪职位，也没有办公室；下面的每一件事都是某个人的一个晚上。",
  ptoPillarFund: "筹集经费",
  ptoPillarFundBody:
    "阅读马拉松、图书义卖、春季植物义卖、爆米花星期五和 Give to the Max Day。筹到的钱用于郊游、教室用品、户外学习空间，以及没有其他来源可以支付的充实课程。",
  ptoPillarCommunity: "把家庭聚在一起",
  ptoPillarCommunityBody:
    "游乐场之夜、运动会、才艺表演、想象力集市、宾果之夜。免费或接近免费，人人可来——这也是八月刚来的家庭到了十月就认得几张面孔的原因。",
  ptoPillarCulture: "为三个课程共同庆祝",
  ptoPillarCultureBody:
    "农历新年、Juntos 晚会与学年末联欢，以及春季艺术与文化节。宾果号码每年都由家长用英语、西班牙语和中文三种语言喊出。",
  ptoPillarStaff: "支持教职员工",
  ptoPillarStaffBody:
    "家长会日的长时间供餐、教师感谢周、备足物资的教职员休息室，以及每年冬天由家长走进教室讲授的 Art Adventure 与 BRAVO 课程。",
  ptoBoardTitle: "由谁负责",
  ptoBoardLead:
    "由家长志愿者选举产生的理事会，再加上任何愿意举手的人。席位每年十月改选，所以本页列出的是职务而不是姓名——姓名在通讯录里，那里才会随时更新。",
  ptoRolePresident: "会长",
  ptoRolePresidentBody:
    "主持会议、统筹活动、批准报销、联系巴士与供应商、组织选举，并代表家长会与学区沟通。",
  ptoRoleVicePresident: "副会长",
  ptoRoleVicePresidentBody:
    "协同主持，并负责图书义卖、阅读马拉松、年鉴、教师感谢周和教职员休息室。",
  ptoRoleSecretary: "秘书",
  ptoRoleSecretaryBody:
    "会议记录、每月的 PTO Corner 通讯、宣传单、心愿清单，以及安排全年活动照片的拍摄与分享。",
  ptoRoleTreasurer: "财务长",
  ptoRoleTreasurerBody: "财务报告、预算、报税、存款与报销。",
  ptoRoleFundraising: "筹款负责人",
  ptoRoleFundraisingBody: "餐厅之夜、阅读马拉松、植物义卖和 Give to the Max Day。",
  ptoRoleVolunteer: "志愿者负责人",
  ptoRoleVolunteerBody:
    "所有志愿者的统筹与报名、纪念品、宾果之夜，以及学年末的答谢活动。",
  ptoRoleTeacherRep: "教师代表",
  ptoRoleTeacherRepBody:
    "教师办公室与家长会之间的桥梁——把教室的需求和资助机会带到会上。",
  ptoRoleMemberAtLarge: "理事",
  ptoRoleMemberAtLargeBody:
    "后备力量：机动人手与单项活动的负责人，哪件事今年需要有人负责就补上。",
  ptoYearTitle: "一年，逐月来看",
  ptoYearLead:
    "家长会举办的全部活动，按发生的顺序排列。日期会变动——日历上永远是最新的。",
  ptoYearRound: "全年进行中：",
  ptoCatFundraiser: "筹款",
  ptoCatCommunity: "社区",
  ptoCatCultural: "文化",
  ptoCatAppreciation: "致谢",
  ptoCatEnrichment: "充实课程",
  ptoCatGovernance: "会议",
  ptoMeetingsTitle: "例会",
  ptoMeetingsBody:
    "每月一次，通常是晚上 6:30 在 {place}，也可以用 Zoom 参加。十月的例会进行理事会选举。欢迎每一个人，我们对您没有任何期待，您一句话不说也完全可以。",
  ptoHelpTitle: "可以怎样帮忙",
  ptoHelpLead: "没有人要占用您一整年。家长会需要的大多只是两个小时，一次就好。",
  ptoHelpMeeting: "来参加例会",
  ptoHelpMeetingBody: "每月一次，大约一小时，也是了解实际情况最快的方式。",
  ptoHelpWishlist: "寄点东西来",
  ptoHelpShop: "买一件校服衫",
  ptoHelpShopBody: "家长会商店的校园服饰。每一笔订单都支持学校，而且不需要账户。",
  ptoHelpMoreCta: "更多帮忙的方式",
  ptoOnThisPage: "本页内容",
  ptoHowResourceTitle: "资源中心",
  ptoHowResourceLead:
    "当一个 Eisenhower 家庭遇到难关时，资源中心就是学校伸出援手的方式——迅速而低调。",
  ptoHowResourceWhat: "钱花在哪里",
  ptoHowResourceWhatBody:
    "新鲜食品、食品杂货、冬衣冬靴，以及购买生活必需品的礼品卡——一个艰难的月份突然需要的那些东西。",
  ptoHowResourceWho: "怎样送到家庭手中",
  ptoHowResourceWhoBody:
    "学校教职员最先看到需要，并亲自、保密地处理每一个请求。只需填一份简短的表格——或者悄悄说一声——也没有任何别人能看到的名单。家长会的任务是让这里永远有钱可用。",
  ptoHowResourceVolunteer: "帮忙运营",
  ptoHowResourceVolunteerBody:
    "固定志愿者负责采购，并让货架保持充足、整齐——每周只需两三个小时。所有近期班次都在报名表上，挑一个合适的即可。",
  ptoHowResourceGive: "怎样捐助",
  ptoHowResourceGiveBody:
    "通过家长会的 Square 商店捐款，或把现金或写明“Resource Center”的支票交到学校前台。",
  ptoHowResourceNoteTitle: "需要帮助吗？",
  ptoHowResourceNoteBody:
    "请填写援助申请表，或致电资源中心。家长会里没有人会知道是谁开口，您也不欠任何人情——它存在的意义正是如此。",
  ptoHowResourceFormCta: "援助申请表",
  ptoResourceFeaturedTag: "当前最需要",
  ptoResourceFeaturedTitle: "冬衣捐赠活动",
  ptoResourceFeaturedBody:
    "资源中心正在收集冬季外套和御寒衣物——长裤、卫衣等——儿童和成人尺码都欢迎。请将捐赠物品放入学校前台标有“WINTER GEAR DRIVE”的收集箱。",
  ptoResourceDonateTitle: "捐助方式",
  ptoResourceGiftCards: "礼品卡",
  ptoResourceGiftCardsBody:
    "食品、汽油或服装的礼品卡，能让家庭把帮助用在当月最需要的地方。请在学校前台留下一张写明“Resource Center”的礼品卡，或来电安排。",
  ptoResourceSquare: "直接捐款",
  ptoResourceSquareBody:
    "通过家长会的商店直接捐款，立刻就能派上用场——金额不限，无需注册账户。也可以把现金或写明“Resource Center”的支票交到学校前台。",
  ptoResourceSquareCta: "打开家长会商店",
  ptoResourceSignupCta: "挑选班次",
  ptoHowVolunteerOpen: "现在哪里需要帮手",
  ptoHowVolunteerRecurring: "每年都会回来的活动：",
  ptoHowWishlistTitle: "教师心愿清单",
  ptoHowWishlistLead:
    "老师自掏腰包补贴教室的开销，比任何人承认的都多。心愿清单能替他们分担一笔：下单买下那样东西，它就会寄到学校。",
  ptoHowWishlistOpen: "打开清单",
  ptoHowWishlistLounge: "教职员休息室",
  ptoHowWishlistLoungeBody:
    "咖啡、茶和点心，送给比您的孩子到得更早的那些人。这就是“Stock the Staff Lounge”背后的那份清单。",
  ptoHowWishlistArt: "美术教室",
  ptoHowWishlistArtBody: "美术教室消耗得最快的那些材料，而且是它真正用得上的规格。",
  ptoHowWishlistFrcBody:
    "资源中心货架上的常备物资——食品、洗护用品和其他生活必需品，直接寄到学校。",
  ptoHowWishlistClassTitle: "班级清单",
  ptoHowWishlistClassLead:
    "老师们也各自有清单。找到您孩子的班级，买一样东西——会直接寄到学校。",
  ptoHowWishlistFilter: "按老师或班级筛选",
  ptoHowWishlistFilterNone: "没有匹配的结果——试试少输入几个字。",
  ptoHowWishlistNoteTitle: "没找到您孩子的老师？",
  ptoHowWishlistNoteBody:
    "老师分享清单后就会添加到这里——通过通讯、家长会谈，或发邮件给家长会。",
  ptoDonateTitle: "捐款",
  ptoDonateLead:
    "家长会完全由志愿者运作，所以捐出的钱几乎原封不动地回到学校——郊游、教室用品、户外学习空间和各项充实课程。",
  ptoDonateCta: "通过 GiveMN 捐款",
  ptoDonateNote:
    "GiveMN 是明尼苏达州的非营利捐赠平台，也是家长会每年十一月举办 Give to the Max Day 活动的地方。您全年任何一天都可以在那里捐款。",
  ptoFindTitle: "联系我们",
  ptoFindLead: "一个问题、一个想法，或者一小时的空闲——以下任何一种方式都能找到真人。",
  ptoOrgTitle: "非营利组织",
  ptoOrgEin: "EIN（税号）",
  ptoOrgNote:
    "家长会是由本校家长运作的独立非营利组织。信件请寄到学校地址；雇主的配捐计划会需要这个税号。",
  ptoNoAccessTitle: "这部分是给家长会理事会的",
  ptoNoAccessBody:
    "规划看板是家长会筹办活动的地方，只对理事会名单上的人开放。本站的其他内容都对您开放。",
  ptoNoAccessNote:
    "如果您认为自己应该有权限，请找一位理事——或者来参加下一次例会，大多数人其实就是这样来的。",
  landingPtoBody: "家长会是谁、全年举办哪些活动，以及如何出一小时力或捐款。",
  landingPtoMore: "每个家庭都已经是会员。无需报名，也不需要账户。",
  landingFrcMore: "求助完全保密，捐助只需一分钟。无需账户。",
  // Lost & found (apps/lostandfound). Category and colour names translate the
  // fixed vocabularies LF_CATEGORIES / LF_COLORS for display only — the stored
  // value stays English, since it is what the model and the filters speak.
  navLostFound: "失物招领",
  brandSubLostFound: "失物招领",
  lfNavBrowse: "浏览",
  lfNavStaff: "工作人员",
  lfBrowseTitle: "丢了东西？",
  lfBrowseLead: "学校里交上来的所有物品，都附有照片。找到你的了吗？打开它，点击“这是我的！”",
  lfLabelTip: "Eisenhower 的家长们反映，用这种布质标签贴给物品写上名字，效果很好",
  lfItemCountOne: "有 1 件物品在等失主。",
  lfItemCount: "有 {n} 件物品在等失主。",
  lfCounts: "{found}，{returned}。",
  lfCountsFoundOne: "找到 1 件物品",
  lfCountsFound: "找到 {n} 件物品",
  lfCountsReturnedOne: "1 件已物归原主",
  lfCountsReturned: "{n} 件已物归原主",
  lfSearchPlaceholder: "试试“蓝色水壶”或“恐龙卫衣”",
  lfSearchLabel: "搜索招领物品",
  lfAllCategories: "所有类别",
  lfCategoryLabel: "类别",
  lfColorLabel: "颜色",
  lfBestMatches: "与“{q}”最匹配的结果",
  lfNoMatches: "没有找到。试试少用几个词，或清除筛选条件。",
  lfEmpty: "目前没有物品。",
  lfShowMore: "显示更多",
  lfDescribing: "正在生成描述…",
  lfFoundToday: "今天捡到",
  lfFoundYesterday: "昨天捡到",
  lfFoundDaysAgo: "{n} 天前捡到",
  lfLoadError: "无法加载物品。请检查网络连接后重试。",
  lfItemGone: "此物品已不在列表中，可能已经归还给失主。",
  lfBackToAll: "所有物品",
  lfFactCategory: "类别",
  lfFactColors: "颜色",
  lfFactBrand: "品牌",
  lfFactMaterial: "材质",
  lfFactWhere: "捡到地点",
  lfFactFound: "捡到日期",
  lfAutoDescribed: "描述由系统根据照片自动生成（英文）。",
  lfZoomIn: "放大",
  lfZoomOut: "缩小",
  lfZoomReset: "重置",
  lfZoomHint: "双指捏合或双击照片可放大，然后拖动查看细节。",
  lfPendingNote: "我们还在为这件物品撰写描述。",
  lfClaimTitle: "这是你的吗？",
  lfClaimLead: "告诉学校办公室，他们会为你留着。",
  lfClaimCta: "这是我的！",
  lfClaimName: "你的姓名",
  lfClaimContact: "电子邮箱或电话",
  lfClaimChild: "孩子的姓名（选填）",
  lfClaimTeacher: "孩子的老师（选填）",
  lfClaimMessage: "你怎么知道这是你的？（选填）",
  lfClaimMessageHint: "例如：底部有凹痕，或贴着贴纸",
  lfClaimSend: "发送给办公室",
  lfClaimSending: "正在发送…",
  lfClaimThanksTitle: "谢谢！",
  lfClaimThanksBody: "办公室已收到你的留言，会与你联系。你也可以直接到失物招领处领取。",
  lfClaimError: "发送失败。请检查姓名和联系方式后重试。",
  lfClaimPrivacy: "只有学校工作人员能看到你在这里填写的内容。",
  lfClaimContactHint: "最好留电子邮箱——物品归还后我们可以自动发邮件通知你。",
  lfReturnSubject: "你的失物正在归还：{item}",
  lfReturnBodyClassroom: "好消息——{school} 失物招领处的“{item}”已通过孩子的班级送回家。",
  lfReturnBodyOffice: "好消息——{school} 失物招领处的“{item}”正在学校前台等你领取。",
  lfReturnBodyFamily: "好消息——{school} 失物招领处的“{item}”已交还给你的家人。",
  lfReturnClosing: "如果没有收到，或与实际情况不符，请联系 {school} 办公室。",
  lfReturnItemFallback: "你认领的物品",
  lfStaffEdit: "编辑此物品",
  lfSignInToAdd: "捡到东西了？登录即可添加",
  lfNavSubmit: "添加物品",
  lfSubmitTitle: "添加拾到的物品",
  lfSubmitLead: "在学校捡到东西了？拍张照片——一张照片一件物品，画面里只拍物品——然后提交。办公室会先审核每件物品，之后才会显示在这里。",
  lfSubmitLocation: "在哪里捡到的？（可选）",
  lfSubmitLocationHint: "适用于本批所有照片。",
  lfSubmitPlaceholder: "例如：体育馆、操场、食堂",
  lfSubmitChoose: "拍照或选择照片",
  lfSubmitAddMore: "添加更多照片",
  lfSubmitChooseHint: "可以一次选多张，也可以连拍。拍横了的照片请点 ↻。",
  lfSubmitNotice: "拍照时请让姓名和标签背向镜头——每件物品公开前都会经办公室审核。",
  lfSubmitOne: "提交 1 件物品",
  lfSubmitMany: "提交 {n} 件物品",
  lfSubmitClear: "清空",
  lfSubmitPreparing: "正在准备 {n} 张…",
  lfSubmitWaiting: "等待上传…",
  lfSubmitUploading: "上传中…",
  lfSubmitDone: "已提交——办公室审核后才会显示。",
  lfSubmitFailed: "上传失败。请检查网络后重试。",
  lfSubmitReadError: "此浏览器无法读取“{name}”。请改用相机拍摄。",
  lfSubmitRotateError: "无法旋转“{name}”。",
  lfNoAccessTitle: "这部分仅供学校工作人员使用",
  lfNoAccessBody: "处理认领和发布物品由负责失物招领的工作人员进行。任何人都可以浏览；登录的成员也可以添加捡到的物品。",
  lfNoAccessNote: "如果你在协助失物招领工作却无法进入，请联系学校办公室。",
  lfCatWaterBottle: "水壶",
  lfCatLunchBox: "午餐盒",
  lfCatJacket: "夹克或外套",
  lfCatSweatshirt: "卫衣或连帽衫",
  lfCatClothing: "其他衣物",
  lfCatWinterWear: "帽子、手套或围巾",
  lfCatShoes: "鞋子或靴子",
  lfCatBag: "背包或包",
  lfCatElectronics: "电子产品",
  lfCatGlasses: "眼镜",
  lfCatJewelry: "首饰或配饰",
  lfCatToy: "玩具",
  lfCatSchoolSupplies: "书本或文具",
  lfCatSports: "运动器材",
  lfCatOther: "其他",
  lfColorBlack: "黑色",
  lfColorWhite: "白色",
  lfColorGray: "灰色",
  lfColorSilver: "银色",
  lfColorRed: "红色",
  lfColorPink: "粉色",
  lfColorOrange: "橙色",
  lfColorYellow: "黄色",
  lfColorGold: "金色",
  lfColorGreen: "绿色",
  lfColorBlue: "蓝色",
  lfColorNavy: "藏青色",
  lfColorPurple: "紫色",
  lfColorBrown: "棕色",
  lfColorTan: "米色",
  lfColorMulticolor: "多色",

  bingoViewOnly: "观看模式 — 登录后可操作游戏板",
  bingoSignInTitle: "登录以操作游戏板",
  bingoSyncError: "已离线 — 网络恢复后游戏板会自动同步。",

  bingoScanTitle: "卡片核对",
  bingoScanAlign: "让卡片对齐框内，手机保持水平",
  bingoScanReading: "正在读取卡片 — 请拿稳（{done}/{total}）",
  bingoScanBingo: "BINGO！这张卡赢了。",
  bingoScanClean: "盖住的数字都已叫到。还没有宾果。",
  bingoScanFalseMarks: "已盖住但未叫到：{nums}",
  bingoScanMissed: "已叫到但未盖住：{nums}",
  bingoScanCamera: "无法使用相机 — 请允许相机权限后重试。",
  bingoScanPhoto: "用照片核对",
  bingoScanFixHint: "点按格子可更正读错的数字。",
  bingoScanNext: "下一张卡",
};

const so: Strings = {
  brand: "Eisenhower",
  brandSub: "Tusmada PTO",
  brandSubCalendar: "Kalandarka PTO",
  done: "Diyaar",
  save: "Kaydi",
  cancel: "Jooji",
  back: "Ku noqo galitaanka",

  signInTitle: "Gal tusmada",
  signInCta: "Gal",
  signInLead:
    "Geli iimaylkaaga, waxaanan kuu soo dirnaa link aad ku gasho. Furaha sirta lama xasuusan doono.",
  emailLabel: "Iimayl",
  emailLink: "Link iigu soo dir iimaylka",
  privateNote: "Waa gaar u ah bulshada {school}. Waxba halkan kuma jiraan wax dadweynuhu arki karo.",
  checkEmailTitle: "Fiiri iimaylkaaga",
  checkEmailLead:
    "Waxaan link galitaan u dirnay {email}. Wuxuu dhacayaa 15 daqiiqo gudahood.",
  openEmailApp: "Fur barnaamijka iimaylka",
  resendLink: "Dib u dir link-ga",
  signingIn: "Waa lagu gelinayaa\u2026",
  signingInSub: "Daqiiqad, tusmada ayaa furmaysa.",
  regClosedTitle: "Mahadsanid \u2014 fiiri iimaylkaaga",
  regClosedLead:
    "Haddii iimaylkani uu leeyahay xubin ka tirsan {school}, link galitaan ayaa soo socda.",
  regClosedNote:
    "Asturnaanta qof walba awgeed, ma xaqiijinno in akoon jiro iyo in kale. Diiwaangelinta cusub waxaa maamula xafiiska dugsiga.",

  navHome: "Bogga hore",
  navDir: "Tusmada",
  navGroups: "Kooxaha",
  navMe: "Adiga",
  navAdmin: "Maamul",
  navMetrics: "Tirokoob",
  navBoards: "Looxyada",
  navApps: "Apps",
  navAppsLead: "Qaybaha kale ee bogga. Hal akoon ayaa meel walba ka shaqeeya.",
  searchMembers: "Raadi xubno",
  searchGroups: "Raadi kooxo",
  myGroups: "Kooxahaaga",
  allGroups: "Dhammaan kooxaha",
  aboutGroupsTitle: "Waa maxay koox?",
  aboutGroupsBody:
    "Kooxuhu waxay habeeyaan bulshada. Qoysku waa reerkaaga; Fasalku waa fasalka macallin. Dugsiyadu waxay sidoo kale kooxaha u isticmaali karaan heer fasaleed, dugsiga oo dhan, ama naadiyo iyo guddiyo. Qof ayaa isku mar ka tirsanaan kara kooxo badan.",
  whatAreGroups: "Waa maxay kooxuhu?",
  colName: "Magaca",
  colType: "Nooca",
  groupsResults: "Natiijooyinka",
  groupsEmpty: "Ma jiraan kooxo waafaqsan raadintaada.",
  directoryEmpty: "Ma jiraan xubno waafaqsan raadintaada.",
  filterByRole: "Ku kala saar doorka",
  filterAllRoles: "Dhammaan",
  filterByType: "Ku kala saar nooca",
  filterAllTypes: "Dhammaan noocyada",
  loadMore: "Soo bandhig wax dheeraad ah",
  showingOf: "Waxaa la tusayaa {shown} ka mid ah {total}",

  navCalendar: "Kalandarrada",
  calendarTitle: "Kalandarka",
  upcomingEvents: "Dhacdooyinka soo socda",
  noEvents: "Ma jiraan dhacdooyin soo socda",
  searchEvents: "Raadi dhacdooyin",
  clearSearch: "Tirtir raadinta",
  noEventsMatch: "Ma jiraan dhacdooyin waafaqsan raadintaada.",
  allDay: "Maalinta oo dhan",
  calendars: "Kalandarrada",
  calendarsHint:
    "Dooro kalandar si aad u qariso dhacdooyinkiisa, mar kalena si aad u soo celiso. Calaamadda + waxay mid ku dartaa barnaamijka kalandarka ee aad hore u isticmaasho, sidaas taariikhaha cusub iyo kuwa isbeddelay iyagaa iskood u imanaya.",
  calendarsHintOne:
    "Calaamadda + waxay kalandarkan ku dartaa barnaamijka aad hore u isticmaasho, sidaas taariikhaha cusub iyo kuwa isbeddelay iyagaa iskood u imanaya.",
  hintDismiss: "Xir",
  downloadIcs: "Soo dejiso {name} (.ics)",
  downloadIcsNote:
    "Waa koobi hal mar ah oo taariikhaha maanta ah. Ma cusboonaysiimayso marka qorshaha dugsigu isbeddelo.",
  subscribeIcs: "Ku biir {name}",
  subscribeLead:
    "Ku dar {name} barnaamijka kalandarka ee aad hore u isticmaasho. Dhacdooyinka cusub iyo kuwa isbeddelay iyagaa iskood u imanaya \u2014 uma baahnid inaad halkan ku soo noqoto.",
  subscribeApple: "Apple Calendar ama Outlook",
  subscribeGoogle: "Google Calendar",
  subscribeOther: "Ama link-gan ku dhaji barnaamij kasta oo kalandar ah",
  subscribeCopy: "Koobi link-ga",
  subscribeCopied: "Waa la koobiyeeyay",
  subscribeNote:
    "Barnaamijyada kalandarku waxay cusboonaysiinta ku hubiyaan jadwalkooda gaarka ah, sidaas darteed isbeddelku wuxuu qaadan karaa dhowr saacadood inuu soo muuqdo.",
  eventTitle: "Dhacdo",
  eventNotFound: "Dhacdada lama helin",
  eventNotFoundBody:
    "Dhacdadan waxaa laga yaabaa in la beddelay ama la qaaday. Kalandarku wuxuu leeyahay waxa soo socda.",
  eventJoinOnline: "Ku soo biir onlayn",

  brandSubNewsletter: "Warsidaha PTO",
  navNewsletter: "Warsidayaasha",
  newsletterArchive: "Daabacaadihii hore",
  newsletterPrefsTitle: "Warsidaha",
  newsletterPrefsLead: "Dooro in warsidaha dugsiga loo diro iimaylkaaga iyo in kale.",
  newsletterSubscribeLabel: "Warsidaha iimayl iigu soo dir",
  newsletterSubscribed: "Waad ku biirtay.",
  newsletterUnsubscribed: "Warsidaha ma heli doontid.",
  unsubscribeTitle: "Ka bax",
  unsubscribeLead: "Ma joojinnaa u dirista warsidaha {email}?",
  unsubscribeConfirm: "Haa, iga saar",
  unsubscribeDone: "Waa lagaa saaray.",
  latestIssue: "Warsidihii ugu dambeeyay",

  volunteersTitle: "Mutadawaciinta",
  volunteersNeeded: "Mutadawaciin ayaa loo baahan yahay",
  volunteerSpotsFilled: "{filled} ka mid ah {slots} ayaa buuxsamay",
  volunteerSpotsLeft: "{left} ayaa weli loo baahan yahay",
  volunteerFull: "Dhammaan way buuxsameen",
  takeASpot: "Boos qaado",
  signInToVolunteer: "Gal si aad u mutadawacdo",
  volunteerWithdraw: "Booska ka noqo",
  volunteerWhoFor: "Yaa is-diiwaangelinaya?",
  volunteerPersonSignedUp: "Horey u diiwaangashan",
  volunteerNote: "Xusuus-qor (ikhtiyaari)",
  volunteerNeedPerson:
    "Marka hore ku dar naftaada ama xubin qoyska ka mid ah, ka dibna waad u diiwaan gelin kartaa meel.",
  volunteerNotePlaceholder: "Wax kasta oo qabanqaabiyuhu u baahan yahay inuu ogaado",
  volunteerSignupsClosed: "Is-diiwaangelintu waa xiran tahay.",
  volunteerNoPositions: "Weli ma jiraan boosas la soo bandhigay.",
  volunteerRunbook: "Sida munaasabaddan loo maamulo",
  eventAlbum: "Albamka sawirada",
  navAlbums: "Sawirada",
  albumsTitle: "Albamada sawirada munaasabadaha",
  albumsEmpty: "Weli albam ma jiro. Marka PTO-gu albam u wadaagto munaasabad, halkan ayuu ka muuqan doonaa.",
  volunteerNamesMembersOnly: "Gal si aad u aragto cidda is-diiwaangelisay.",
  volunteerAlready: "Horey ayaad tan isugu diiwaangelisay.",
  volunteerTookLastSpot: "Qof ayaa hadda qaatay booskii ugu dambeeyay.",
  volunteerError: "Taasi ma shaqayn. Fadlan mar kale isku day.",
  volunteerNotFound: "Warqadda is-diiwaangelinta lama helin",
  volunteerNotFoundBody: "Link-gan waa laga yaabaa inuu dhacay, ama is-diiwaangelinta la qaaday.",
  volunteerEntryPrefix: "Tabarruc",
  volunteerAddToCalendar: "Ku dar kalandarka",
  volunteerAddGoogle: "Google Calendar",
  volunteerAddIcs: "Apple, Outlook iyo kuwo kale (.ics)",
  volunteerSignedUpTitle: "Waa lagu diiwaangeliyey",
  volunteerSignedUpBody: "Ku dar kalandarkaaga si aanad u illoobin. Haddii dugsigu dhacdada beddelo, galka kalandarku wuxuu kuu soo celinayaa halkan si aad u aragto macluumaadka ugu dambeeyay.",
  volunteersPageLead: "Dhacdooyinka soo socda ee weli caawimaad u baahan. Fur mid si aad u aragto wakhtiyada oo aad isu diiwaangeliso.",
  volunteersPageNone: "Hadda ma jirto dhacdo mutadawaciin u baahan — boosaska oo dhan waa la buuxiyay. Mar kale soo fiiri.",

  neighbors: "Deriska",
  noNeighbors: "Weli ma jiraan deris kuu dhow.",
  noNeighborsBody:
    "Deriska waxay soo muuqdaan marka xubno kale oo 2 mayl gudaheeda ah ay ciwaankooda u shidaan \u201cI tus sida deris\u201d. Qoyskaaga halkan lagama liisgareeyo.",
  seeAll: "Arag dhammaan",
  groups: "Kooxahaaga",
  member: "Xubin",
  connect: "La xiriir",
  connected: "Waa la xiriiray",
  yourProfile: "Profile-kaaga",
  preview: "Horudhac",
  whatYouShare: "Waxaad wadaagto",
  membersN: "Xubnaha",
  privateN: "Gaar ah",
  sharedN: "La wadaagay",
  shownAsNeighbor: "Waxaa lagu tusayaa sida deris",
  on: "Shidan",
  off: "Xiran",
  welcome: "Ku soo dhawoow {school}",
  addAddressTitle: "Ku dar ciwaankaaga si aad deriska u aragto",
  addAddressBody:
    "Waxaan ku tusi doonnaa xubnaha kuu dhow iyo masaafo qiyaastii ah \u2014 waligeen ma tusi doonno ciwaankaaga saxda ah.",
  addAddressBtn: "Ku dar ciwaan",
  osmAttribution: "Masaafooyinka \u00a9 tabarucayaasha OpenStreetMap",
  noGroups: "Weli koox kuma jirtid",
  noGroupsBody:
    "Samee qoyskaaga si aad ugu darto dadka aad la nooshahay. Fasallada waxaa ku dara macallin ama xafiiska.",
  finishTitle: "Dhammee profile-kaaga",
  finishBody: "Ku dar taleefan ama sawir si kooxahaagu ay kuula soo xiriiraan.",
  finishBtn: "Sii wad dejinta",

  editProfile: "Wax ka beddel profile-ka",
  previewingAsMember: "Waxaad u eegaysaa sida xubin",
  whatOthersSee: "Kani waa waxa xubnaha kale arkaan",
  hiddenFromMembers: "{count} ayaa laga qariyay xubnaha",
  unlistedSection: "Ku soo baxa buugga",
  unlistedOn: "Liiska laga saaray. Waa laga qariyay buugga, raadinta, liiska kooxaha iyo deriska xubnaha kale — weli way u muuqataa maamulayaasha iyo qofka maareeya astaantan.",
  unlistedOff: "Si caadi ah ayuu u soo baxaa, sida xubin kasta oo kale.",
  unlistedRemove: "Ka saar buugga",
  unlistedRestore: "Ku celi buugga",
  accessPendingTitle: "Waxaan eegaynaa codsigaaga",
  accessPendingBody:
    "Qof ka tirsan PTO-da ayaa eegaya waxaad buuxisay. Badanaa way dhaqsataa. Waxaad arki doontaa buugga marka la ansixiyo.",
  accessDeclinedTitle: "Ma aanan xaqiijin karin codsigaaga",
  accessDeclinedBody:
    "Ma aanan ku xidhi karin waxaad buuxisay qoys ka tirsan iskuulka. Haddii wax qaldan yihiin ama maqan — magac si khaldan loo qoray, fasal khaldan — hoos ku saxo oo mar kale codso.",
  accessFormTitle: "Codso inaad aragto buugga",
  accessFormLead:
    "Buuggu wuxuu ku jiraa magacyada iyo xiriirka qoysaska kale, sidaas darteed waxaan hubinnaa in akoon kastaa uu ka tirsan yahay qoys dugsiga ka tirsan ka hor inta aan la furin. Noo sheeg cidda aad tahay iyo cidda ilmahaagu yahay, waanan eegi doonaa.",
  accessNeedName: "Ku dar magacaaga koowaad iyo kan dambe",
  accessNeedStudent: "Ku dar ugu yaraan hal ilmo",
  accessNeedClassroom: "Dooro fasalka ilmahaaga",
  accessOrStaff: "Ama, haddii aad dugsiga ka shaqayso",
  accessNeedStaff: "Isku calaamadi macallin ama shaqaale, oo hoos noogu sheeg fasalka ama shaqada",
  accessNoteLabel: "Wax kale oo aan ogaano? (ikhtiyaari)",
  accessNotePlaceholder: "tusaale: waxaan bilownay Janaayo, ama ilmahaygu magac kale ayuu isticmaalaa",
  accessSubmit: "Codso gelitaan",
  accessSubmitFailed: "Ma dirsan. Fiiri tallaabooyinka kore oo mar kale isku day.",
  accessSubmitted: "Codsiga waa la diray",
  accessMeanwhile:
    "Inta lagu jiro waxaad isticmaali kartaa jadwalka, iskaa wax u qabso, akhri wargeyska, oo maamul qoyskaaga.",
  accessNeedContact: "Ku dar ugu yaraan hal hab lagula xiriiro qoyskaaga — taleefan, iimayl ama cinwaan",
  accessContactTitle: "Ku dar xogta xiriirkaaga",
  accessContactBody:
    "Hal tallaabo ayaa hadhay. Buugga xogtu waa laba dhinac: qoysasku waxay wadaagaan sida loola xiriiro. Ku dar ugu yaraan hal taleefan, iimayl ama cinwaan, buugga xogtuna wuu furmayaa.",
  unlistedBadge: "Aan la liisgelin",
  exitPreview: "Ka bax horudhaca",
  contact: "Xiriir",
  saveContact: "Kaydi xiriirka",
  fromGroup: "laga helay {name}",
  shareCta: "Xogtaada la wadaag {name}",
  homeLabel: "Ciwaanka Guriga",
  mobile: "Mobiil",
  email: "Iimayl",
  website: "Website",
  typeAddress: "Ciwaan",
  typePhone: "Taleefan",
  exactHidden: "Ciwaanka saxda ah waa qarsoon yahay",
  firstName: "Magaca hore",
  lastName: "Magaca dambe",
  setupTitle: "Deji profile-kaaga",
  setupLead: "Ku dar magacaaga si bulshadaadu kuugu garato tusmada.",
  createProfileBtn: "Samee profile-kayga",
  skipToAdmin: "U bood console-ka maamulka",
  welcomeFamilyTitle: "Yaa kale oo guriga kula jooga?",
  welcomeFamilyLead:
    "Ku dar carruurtaada iyo lammaanahaaga si qoyskaagu wada muuqdo. Mar walba ayaad markii dambe samayn kartaa.",
  welcomeAddChild: "Ku dar ilme",
  welcomeAddPartner: "Ku dar lammaanahayga",
  welcomeChildHeading: "Ilmahaaga",
  welcomePartnerHeading: "Lammaanahaaga",
  welcomeAddSubmit: "Ku dar",
  welcomeAddedLabel: "Waxaa la daray: {count}",
  inviteFailed: "Ma dirin karin casuumaadda. Hubi cinwaanka iimaylka oo isku day mar kale.",
  welcomeSkip: "Hadda ka bood",
  welcomeContinue: "Sii wad",
  welcomeNameError: "Ma aan samayn karin profile-kaaga. Fadlan isku day mar kale.",
  welcomeAddError: "Ma aan ku dari karin. Fadlan isku day mar kale.",
  welcomeDoneTitle: "Wax walba diyaar",
  welcomeDoneLead:
    "Qoyskaagu wuxuu ku jiraa tusmada. Mar kasta ayaad dad kale kaga dari kartaa Kooxaha.",
  welcomeDoneCta: "Aad tusmada",
  welcomePartnerEmail: "Iimaylkooda (ikhtiyaari)",
  welcomePartnerEmailNote:
    "Waxaan u diri doonnaa link ay ku maamulaan profile-kooda.",
  welcomeInviteFailed:
    "{name} waa la daray, laakiin casuumaadda iimaylka ma dirsan. Markii dambe ayaad kaga casuumi kartaa profile-kooda.",
  welcomeExistingLabel: "Horey ugu jira qoyskaaga",
  welcomeExistingNote: "Qof qoyskaaga ka mid ah ayaa horey u daray dadkan. Uma baahnid inaad mar kale darto.",
  welcomeExistingLead:
    "Qoyskaagu horey buu halkan u joogay — waxaa daray qofkii bilaabay. Ku dar qofkii ka maqan.",
  welcomeInviteFamily: "U ogolow inay maamulaan qoyskeenna oo dhan",
  welcomeInviteFamilyNote:
    "Way arki kartaa oo wax ka bedeli kartaa qof kasta oo halkan jooga, sidaas darteed uma baahna inay qoyska mar kale daraan.",
  removePerson: "Ka saar buugga",
  removePersonTitle: "Ma ka saaraysaa {name}?",
  removePersonBody:
    "Tan waxay si joogto ah u tirtiraysaa {name} iyo wax kasta oo profile-kooda ku jira. Lama soo celin karo.",
  removePersonConfirm: "Haa, si joogto ah u saar",
  removePersonCounts: "Waxaa la tirtiri doonaa {contacts} xiriir iyo {groups} xubinnimo koox.",
  removePersonSignups: "Waxaa la joojin doonaa {count} isdiiwaangelin mutadawacnimo.",
  removePersonEmptied: "{name} waa xubintii ugu dambaysay ee qoyskooda, sidaas darteed qoyskana waa la tirtirayaa.",
  removePersonShared:
    "Qof kale ayaa sidoo kale maamula {name}, markaa kaligaa ma saari kartid. Marka hore weydiiso inay joojiyaan maamulka {name}.",
  removePersonHouseholdAdmin:
    "{name} waa maamulaha kaliya ee qoys wali xubno kale leh. Marka hore halkaas ku dar maamule kale.",
  removePersonError: "Lama saari karin. Isku day mar kale.",
  householdAutoName: "Qoyska {lastName}",
  householdAutoNameFallback: "Qoyska {firstName}",
  noGroupsCta: "Samee qoyskaaga",
  addFamilyTitle: "Ku dar qoyskaaga",
  addFamilyBody:
    "Ku dar carruurtaada iyo lammaanahaaga si qoyskaagu tusmada ugu wada muuqdo.",
  addFamilyCta: "Ku dar qoys",
  addFamilyDismiss: "Malaha markii dambe",
  alwaysVisible: "Had iyo jeer waa la arkaa",
  firstFixedWhy:
    "Dadku waxay u baahan yihiin magac ay kugu garan karaan. Wax kasta oo kale adigaa doorta.",
  lnFull: "Buuxa",
  lnInitial: "Xarafka hore",
  shownAs: "Waxaa lagu tusayaa",
  photo: "Sawirka profile-ka",
  addPhoto: "Ku dar sawir",
  photoOwnFamilyHint: "Fadlan soo geli oo keliya sawirka qoyskaaga — ha soo gelin carruurta dadka kale.",
  addContact: "Ku dar xog xiriir",
  showAsNeighbor: "I tus sida deris",
  neighborWhy:
    "Waxay xubnaha kuu dhow tusaysaa magacaaga iyo masaafo qiyaastii ah oo keliya \u2014 waligeed ma tusayso ciwaankaaga.",
  whoManages: "Yaa maamula profile-kan",
  inviteCoManager: "Qof ku casuum inuu kaa caawiyo maaraynta {name}",
  owner: "Milkiile",
  inviteTitle: "Qof ku casuum inuu kaa caawiyo maaraynta {name}",
  inviteWhy:
    "Wuxuu noqonayaa maamule-wadaag, wuxuuna wax ka beddeli karaa profile-ka {name}. Adiguna weli gelitaan ayaad haysataa.",
  inviteSend: "Dir casuumaadda",
  inviteSent: "Casuumaad loo diray {email}.",

  visMembers: "Xubnaha",
  visPrivate: "Gaar ah",
  visShared: "La wadaagay",
  visMembersDesc: "Qof kasta oo {school} ku gala",
  visPrivateDesc: "Adiga oo keliya, ilaa aad wadaagto",
  visSharedDesc: "Gaar ah, iyo dadka iyo kooxaha aad dooratay",
  whoCanSee: "Yaa arki kara {field}-kaaga?",
  sharedWith: "Waxaa la wadaagay",
  addPeople: "Ku dar dad ama kooxo",

  household: "Qoys",
  classroom: "Fasal",
  genericGroup: "Koox",
  genericGroupSub: "Dugsi, heer fasaleed, naadi, ama guddi",
  genericManages: "{name} ayaa maamula kooxdan.",
  roster: "Liiska",
  members: "Xubnaha",
  manage: "Maaree",
  youreAdmin: "Waxaad tahay maamule",
  viewOnly: "Xubin \u00b7 daawasho oo keliya",
  classMember: "Xubin fasalka",
  teachThisClass: "Adigaa bara fasalkan",
  addMember: "Ku dar xubin",
  myChildren: "Carruurtayda",
  addMyChild: "Ku dar cunugayga",
  inThisClass: "Fasalkan ayuu ku jiraa",
  movesFrom: "Hadda wuxuu ku jiraa {name} — tani way u wareejinaysaa.",
  notInAClass: "Weli fasal kuma jiro",
  noStudentsToPlace: "Carruurtaada midna weli looma diyaarin inay arday yihiin.",
  classPlacementNote: "Cunug hal fasal buu ku jiraa mar kasta. Waad bedeli kartaa marka ay khaldan tahay.",
  classPlacementFailed: "Fasalkiisa lama beddeli karin. Isku day mar kale.",
  setTitle: "Deji darajada",
  setTitles: "Deji darajooyinka",
  editGroupInfo: "Wax ka beddel xogta",
  householdContact: "Xiriirka qoyska",
  cascadeNote: "Waxay khusaysaa qof kasta oo qoyska ku jira.",
  manageMembers: "Maaree xubnaha",
  messageAll: "Fariin u dir dhammaan",
  adminManages: "{name} ayaa maamula qoyskan. Weydii maamule si isbeddel loo sameeyo.",
  teacherRuns: "{name} ayaa maamula fasalkan. Waxaad arki kartaa ardayda fasalka ee xogtooda la wadaaga xubnaha.",
  newGroup: "Cusub",
  newHousehold: "Qoys cusub",
  newClassroom: "Fasal cusub",
  groupName: "Magaca",
  create: "Samee",
  createGroupChoose: "Maxaad samayn lahayd?",
  createSubgroup: "Samee koox-hoosaad",
  subgroups: "Kooxaha hoose",
  parentGroup: "Kooxda sare",
  setParentGroup: "Deji kooxda sare",
  parentNone: "Koox sare ma leh (heerka ugu sarreeya)",
  noEligibleGroups: "Ma jiraan kooxo u qalma.",
  editGroup: "Wax ka beddel kooxda",
  renameGroup: "Magac beddel",
  deleteGroup: "Tirtir kooxda",
  deleteGroupConfirm: "Ma tirtiraa \u201c{name}\u201d?",
  deleteGroupWarn: "Tan dib looma soo celin karo.",
  deleteGroupKeepsPeople: "{count} qof ee ku jira way ku sii jiraan tusmada \u2014 waxaa keliya la saarayaa kooxda iyo xogta xiriirka ee ay wadaagto.",
  deleteGroupHasChildren: "Marka hore u dhaqaaji ama tirtir kooxaheeda hoose.",
  deleteGroupFailed: "Kooxdan lama tirtiri karin.",
  renameGroupFailed: "Kooxdan magaceeda lama beddeli karin.",
  groupType: "Nooca",
  groupTypeChangeNote: "Nooca ayaa go\u2019aaminaya waxa kooxdu qabato. Qoys keliya ayaa ciwaan la wadaaga xubnihiisa oo ka soo muuqda helitaanka deriska.",
  changeTypeFailed: "Nooca kooxdan lama beddeli karin.",
  changeTypeHasChildren: "Qoysku ma qaadan karo kooxo hoose \u2014 marka hore ka saar.",
  reparentFailed: "Kooxdan lama dhaqaajin karin.",
  reparentRejected: "Kooxdaasi ma noqon karto tan sare \u2014 mid kale dooro.",
  confirmDelete: "Haa, tirtir",
  systemAdmin: "Maamulaha nidaamka",
  groupAdminRole: "Maamulaha kooxda",
  noOneToAdd: "Cid lagu daro ma harin.",
  removeFromGroup: "Ka saar kooxda",
  removeMemberConfirm: "Ma ka saaraa {name} kooxdan?",
  removeMemberKeepsPerson: "Wuxuu ku sii jiri doonaa tusmada iyo kooxaha kale ee uu ku jiro.",
  removeMemberLastAdmin: "Marka hore qof kale maamule ka dhig.",
  removeMemberFailed: "Lagama saari karin kooxda.",
  confirmRemove: "Haa, ka saar",
  appErrorTitle: "Shaashaddan way joogsatay",
  appErrorBody: "Wax baa naga khaldamay. Dib-u-cusboonaysiintu badanaa way hagaajisaa — waxaad qortay lama dirin.",
  appErrorReload: "Dib u cusboonaysii",

  capParent: "Waalid",
  capTeacher: "Macallin",
  capStaff: "Shaqaale",
  capStudent: "Arday",
  capHouseholdAdmin: "Maamulaha qoyska",

  actingAs: "Waxaad u dhaqmaysaa sida",
  addPerson: "Ku dar qof",

  addPersonTitle: "Ku dar qof",
  addPersonLead: "Ku dar ilme, lammaane, ama qof kale oo aad maamusho. Waxaad awoodi doontaa inaad sidiisa u dhaqanto si aad profile-kiisa wax uga beddesho.",
  addPersonBtn: "Ku dar qofka",
  personType: "Nooca",
  personTypeNote: "Ikhtiyaari. Tan dib ayaad u beddeli kartaa.",
  personTypeEditNote: "Waxay u muuqataa sida calaamado magaca dhinaciisa ah ee tusaha.",
  personHousehold: "Qoys",
  personHouseholdNote: "Ikhtiyaari. Wuxuu qoys ku darayaa si ciwaanka la wadaago u khuseeyo.",
  householdNone: "Qoys ma leh",

  language: "Luqadda",
  languageNote: "Waxay tusmada u beddeshaa adiga oo keliya.",

  footerFeedback: "Talo u dir {email}",

  landingWelcome: "Soo dhawoow",
  landingTitle: "{school} — tusmo, kalandar iyo warsidaha",
  landingDescription:
    "Tusmada, kalandarka, warsidaha iyo isdiiwaangelinta mutadawaciinta ee qoysaska {school} ee {city}. Waxaa lagu heli karaa {languages}.",
  landingLead:
    "Wax kasta oo {school} qoysaska u haysato meel keliya: tusmo muujinaysa cidda dadku yihiin, kalandarka dugsiga, iyo warsidaha. Hal xisaab ayaa saddexdaba kuu furaysa.",
  landingReadIn: "Bogga ku akhri {language}",
  landingCreateAccount: "Xisaab samayso",
  landingNoPassword:
    "Ma jiro furaha sirta ah oo aad xasuusan lahayd — link aad ku gasho ayaan iimayl kuugu soo dirnaa.",
  landingSeeCalendar: "Eeg kalandarka",
  landingWhatsHere: "Waxa halkan yaal",
  landingMembersOnly: "Xubnaha oo keliya",
  landingOpenToAll: "U furan qof walba",
  landingOpen: "Fur {name}",
  landingDirBody:
    "Raadi qoyska ardayga fasalka la dhiganaya, macallin, ama qofka wax u qabta hawsha aad isku qortay. Wax kasta oo aad gelisid wuxuu ku bilaabmayaa inuu gaar yahay, adigana waxaad go'aamisaa mid mid cidda arki karta.",
  landingDirMore:
    "{feature}: dooro oo waxaad arki doontaa qoysaska xubnaha ah ee kuu dhow — magac iyo masaafo qiyaastii ah oo keliya, waligeed ma aha ciwaan.",
  landingCalBody:
    "Riwaayado, kulamo waalid-macallin, bannaanbax, liiska cuntada qadada, iyo maalmaha aan dugsigu jirin. Hal mar ku biir, sanad-dugsiyeedka oo dhanna wuxuu iskiis ugu cusboonaanayaa abka kalandarka ee aad hore u isticmaasho.",
  landingCalMore: "{feature}: boos ka qaado dhacdada boggeeda toos ah.",
  landingNewsTitle: "Warsidaha",
  landingNewsBody:
    "Warka PTO-da ayaa dhowr toddobaad kasta iimaylkaaga ku soo gelaya: waxa soo socda, waxa la qabtay, iyo waxa weli gacmo u baahan.",
  landingNewsMore:
    "Qof kastaa wuu ku biiri karaa, daabacaadihii hore oo dhanna internetka ayay ku yaalliin. Xisaab looma baahna.",
  landingJoinTitle: "Ku biir tusmada",
  landingJoinBody:
    "Waxay qaadanaysaa dhowr daqiiqo. Waxba halkan kuma jiraan wax dadweynuhu arki karo — tusmadu waa u xiran tahay qof kasta oo bulshada {school} ka baxsan, adigana waxaad dooranaysaa waxa inta kale arkayso.",
  faqTitle: "Sida ay u shaqeyso",
  faqPrintTitle: "Websaydka {school}",
  faqDescription:
    "Waxa {school} ay onlaynka ugu haysato qoysaska {city} — buugga xiriirka, jadwalka, isqorista mutadawiciinta iyo warsidaha — sida loo helo akoon, iyo cidda arki karta waxa. Waxaa lagu heli karaa {languages}.",
  faqLead:
    "Wax kasta oo {school} ay qoysaska u hayso halkan ayey ku yaalliin: cidda ay yihiin, waxa soo socda, iyo waxa weli gacmo u baahan. Hal akoon ayaa dhammaan furaya, mana jirto furaha sirta ah oo aad xasuusato — taa beddelkeeda waxaan emayl kuugu soo dirnaa xiriiriye aad ku gasho.",
  faqNav: "Sida ay u shaqeyso",
  faqVolunteerTitle: "Isqorista mutadawiciinta",
  faqVolunteerBody:
    "Bog kasta oo dhacdo ah wuxuu muujiyaa booskii weli bannaan, qof kastaana wuu arki karaa tiradooda. Inaad mid qaadato waxay u baahan tahay akoon, si PTO-du u ogaato cidda la filayo.",
  faqGetInTitle: "Sida loo galo",
  faqStep1Title: "Booqo {host}",
  faqStep1Body: "Dooro {action}.",
  faqStep2Title: "Geli emaylkaaga",
  faqStep2Body: "Taasi waa foomka oo dhan. Weligeen furaha sirta ah ma weydiino, maxaa yeelay mid ma jiro.",
  faqStep3Title: "Guji xiriiriyaha aan kuu soo dirno",
  faqStep3Body:
    "Wuxuu ku soo gaarayaa hal ama laba daqiiqo, shan iyo tobanka daqiiqo ee xigana wuu shaqeeyaa. Marka aad mar dambe soo gasho si la mid ah ayey u shaqeysaa.",
  faqFamilyTitle: "Kadibna ku dar qoyskaaga.",
  faqFamilyBody:
    "Habayntu waxay ku weydiinaysaa cidda kale ee gurigaaga jooga si qoyskaagu wadajir u soo baxo — carruurtaada, iyo lammaanahaaga, oo hela gelitaan u gaar ah kuna maamuli kara isla qoyska. Waxaad mar dambe samayn kartaa; waxba ma xidhna.",
  faqApprovalTitle: "Waan hubinnaa ka hor inta aan buugga la furin",
  faqApprovalBody:
    "Sababtoo ah buuggu wuxuu ku jiraa magacyada iyo xiriirka qoysaska kale, qof ka tirsan PTO-da ayaa hubiya in akoon kastoo cusub uu ka tirsan yahay qoys dugsiga ka tirsan — waxaad noo sheegtaa cidda ilmahaagu yahay iyo fasalka uu ku jiro, annaguna waan eegnaa. Badanaa way dhaqsataa. Inta aad sugayso waxaad hore u isticmaali kartaa jadwalka, iskaa wax u qabso, oo akhri wargeyska.",
  faqPrivacyTitle: "Cidda arki karta waxa — adigaa go'aamiya, mid mid",
  faqNoPublicLead: "Ma jirto doorasho afraad.",
  faqNoPublicBody:
    "Waxba oo buugga xiriirka ku jira weligood dadweyne uma furna. Wuxuu u xidhan yahay qof kasta oo ka baxsan bulshada {school}, mashiinada raadintana waxaa laga codsaday inay ka fogaadaan. Taleefankaaga, emaylkaaga iyo cinwaankaagu mid kastaa wuxuu leeyahay doorashadiisa, sidaas darteed waa lagu heli karaa iyadoo aan lagula xidhiidhi karin, ama si ka soo horjeeda.",
  faqKnowTitle: "Wax wanaagsan in la ogaado",
  faqAddressTitle: "Cinwaankaagu adigaa iska leh",
  faqAddressBody:
    "Xubnaha kale weligood ma arkaan cinwaanka saxda ah ee aad gelisay — waxay arkaan oo keliya qoyska uu ka tirsan yahay. Buugga xiriirka dibaddiisa qofna waxba ma arko.",
  faqNeighborsTitle: "Deriska waa ikhtiyaari",
  faqNeighborsBody:
    "U shid \u201Ci tus sida deris\u201D cinwaan, qoysaska xubnaha ah ee laba mayl gudaheeda joogaana way ku heli karaan: magac iyo masaafo qiyaasi ah, waligeed ma aha cinwaan waddo. Haddii aad damiso, si fudud ma soo baxdid.",
  faqUnlistedTitle: "Waad ka bixi kartaa liiska",
  faqUnlistedBody:
    "Haddii aad doorbidayso inaan gabi ahaanba lagu liistin, noo soo qor waanan qoyskaaga ka saarnaa buugga xiriirka. Waxaad haysataa akoonkaaga, jadwalka iyo warsidaha.",
  privacyTitle: "Asturaynta",
  privacyNav: "Asturaynta",
  privacyLead:
    "{school} ayaa boggan u maamula qoysaska dugsiga. Boggan wuxuu sheegayaa waxa la kaydiyo, cidda arki karta, iyo waxa aanan weligeen ururin doonin. Waxaa loo qoray in la akhriyo, ee ma aha in la oggolaado.",
  privacyDescription:
    "Waxa buugga xiriirka ee {school} uu ka hayo qoyskaaga, cidda arki karta, waxa aanan weligeen ururin, iyo sida loo tirtiro.",
  privacyUpdated: "Markii ugu dambeysay ee la cusboonaysiiyay {date}.",
  privacyHoldTitle: "Waxa aan haysanno",
  privacyHoldBody: "Kaliya waxa waalidku qoro. Waxba lagama soo dejiyo dugsiga ama degmada.",
  privacyHoldName: "Magacaaga, iyo magaca hore ee ilmo kasta oo aad ku darto.",
  privacyHoldContact: "Telefoon, iimayl ama cinwaan kasta oo aad doorato inaad ku darto — mid walba ikhtiyaari.",
  privacyHoldPhoto: "Sawir, haddii aad mid soo gasho.",
  privacyHoldChild: "Fasalka aad noo sheegto in ilmahaagu ku jiro.",
  privacyHoldAddress:
    "Haddii aad ku darto cinwaan guri, waxaan u beddelnaa qiyaasaha khariidadda si astaanta ikhtiyaariga ah ee deriska u shaqeyso. Qiyaasahaasi weligood kama baxaan server-keenna lagumana tuso cidna.",
  privacyDefaultTitle: "Gaar ahaanshuhu waa caadiga",
  privacyDefaultBody:
    "Xog kasta oo xiriir waxay ku bilaabmaan gaar, wayna sii ahaanayaan ilaa aad beddesho. Mid walba wuxuu leeyahay doorashadiisa — la arki karo xubnaha, la wadaago koox gaar ah, ama gaar — sidaas darteed waad ku jiri kartaa liiska adigoon la gaadhi karin. Ma jirto hab wax loogu dhigo dadweynaha meelna oo ka mid ah boggan.",
  privacyChildrenTitle: "Carruurta",
  privacyChildrenBody:
    "Ilmuhu akoon ma laha mana geli karo. Wax kasta oo ilmaha ku saabsan waxaa geliya oo xakameeya waalidkiisa, oo mar kasta beddeli kara ama tirtiri kara. Maanta ilmo midna oo buuggan ku jira ma laha telefoon ama cinwaan ku xidhan.",
  privacyBusTitle: "Waxa aanan weligeen ururin doonin",
  privacyBusBody:
    "Ma ururinno oo ma ururin doonno macluumaadka gaadiidka ama baska — jidad ma jiraan, goobo joogsi ma jiraan, waqtiyo qaadis ama dejin ma jiraan. Sidoo kale ma weydiisanno taariikhda dhalashada, macluumaad caafimaad, diiwaanka dugsiga ama darajooyinka. Haddii taasi marnaba u baahato inay beddesho, boggan ayaa markii hore beddelaya.",
  privacyWhoTitle: "Cidda arki karta",
  privacyWhoBody:
    "Kaliya xubnaha gashay oo akoonkooda qof ansixiyay. Abuurista akoon kaligeed kuma filna: waxaad noo sheegtaa cidda ilmahaagu yahay iyo fasalka uu ku jiro, qofna wuu hubiyaa ka hor inta buugga la furin. Mashiinada raadinta waxaa lagu wargeliyaa inaanay gelin bog kasta oo xubnaha u gaar ah, meelna kuma daabacno buugga.",
  privacyDeleteTitle: "Ka saarista qoyskaaga",
  privacyDeleteBody:
    "Waxaad ka tirtiri kartaa profile-kooda qof kasta oo aad maamusho, waana isla markiiba oo joogto ah — magacooda, xiriirkooda iyo sawirkooda oo dhan way baxayaan. Waxaad sidoo kale na weydiisan kartaa annagana waan kuu samaynaa. Waxaan hayn diiwaan taariikhaysan oo sheegaya in akoon wax qabtay, maxaa yeelay diiwaankaasi waa waxa boggan xisaab looga qaadi karo, laakiin xog xiriir ma wato.",
  privacyServicesTitle: "Adeegyada aan ku tiirsanahay",
  privacyServicesBody:
    "Dhowr shirkadood ayaa qayb ka qabta arrintan annaga oo matalaya. Mid walba wuxuu arkaa kaliya waxa shaqadiisu u baahan tahay:",
  privacyServiceHosting:
    "Cloudflare — martigelinta, xogta iyo kaydinta faylalka. Wax kasta oo halkan ah wuxuu ku nool yahay qalabkooda. Cloudflare wuxuu sidoo kale tiriyaa booqashooyinka bog kasta oo halkan ah — bogga, goobta kuu soo gudbisay, browser-kaaga iyo dalka — iyadoo aan cookies la isticmaalin oo aan laguu raacin goobo kale.",
  privacyServiceEmail:
    "Cloudflare Email — wuxuu gaadhsiiyaa iimaylkeenna, sidaas darteed wuxuu qabtaa cinwaanka loo diro fariinta iyo waxa fariintu sheegayso.",
  privacyServiceMaps:
    "OpenStreetMap — haddii aad ku darto cinwaan, hal mar ayaa loo diraa si loogu beddelo qiyaaso. Sawirada khariidadda waxaa soo qaata server-keenna, oo ah sanduuq khariidad ee ma aha cinwaan, sidaas darteed browser-kaagu weligiis cidna kama weydiisto.",
  privacyServiceStore:
    "Stripe iyo Printful — kaliya haddii aad wax ka iibsato dukaanka, oo kaliya magaca iyo cinwaanka rarista ee aad qorto markaad bixinayso. Dalab dukaan weligiis lagama xidho profile buugga.",
  privacyServiceTranslate:
    "Google Translate — waxaa lagu bixiyaa bogagga warsidaha ee horeba u ahaa dadweyne. Wax xubnaha u gaar ah weligood looma diro.",
  privacyServiceAdmin:
    "Slack — kanaal gaar ah oo maamulaha boggu isticmaalo ayaa hela ogeysiis, oo ay ku jirto cinwaanka iimaylka, marka qof cusub isdiiwaangeliyo.",
  privacyServiceAi:
    "Cloudflare Workers AI — wuxuu sharxaa sawirrada alaabta lumay si loo raadin karo, oo marka tifaftiraha wargeysku codsado, wuxuu soo jeediyaa isbeddello lagu sameeyo qoraalka wargeyska. Waxaa loo dira kaliya sawirradaas iyo qoraalladaas, weligeedna wax ka mid ah hagaha looma diro.",
  privacyServiceFonts:
    "Typography.com (Hoefler&Co) — wuxuu bixiyaa far-qoraalka looxa bingo-ga ee habeenka ciyaarta. Browser-kaagu wuxuu faylasha farta si toos ah uga soo qaadaa iyaga, sidaas darteed waxay arkaan codsigaas (cinwaanka IP-gaaga iyo browser-kaaga), laakiin waxba kama arkaan hagaha.",
  privacyLostFoundTitle:
    "Alaabta lumay",
  privacyLostFoundBody:
    "Alaabta lumay waa qaybta kaliya ee boggan oo si ula kac ah u furan: shaqaalaha iyo xubnaha galay ayaa sawira alaabta dugsiga lagu soo celiyo, qof kastana wuu eegi karaa. Magac shay ku qoran waxaa arka shaqaalaha oo kaliya; weligiis kama muuqdo bogga guud ama raadintiisa. Qoraal kale, sida magaca shirkadda (brand), wuxuu ka muuqan karaa sharaxaadda si alaabta si fudud loo helo. Shay qoraal leh — iyo shay kasta oo xubin ay ku darto — waa la qariyaa ilaa xubin shaqaale ah ay hubiso sawirka. Haddii aad sheegto in shay adiga kuu leeyahay, magaca, xiriirka iyo qoraalka aad qorto waxaa arka shaqaalaha oo kaliya, waxaana la tirtiraa 60 maalmood kadib marka codsigaaga la xalliyo. Shay la celiyay iyo sawirkiisa waxaa la tirtiraa 30 maalmood kadib.",
  landingLfBody:
    "Wax kasta oo dugsiga lagu soo celiyay, sawir leh. Raadi waxa kaa maqan oo u sheeg xafiiska inuu adiga kuu leeyahay.",
  landingLfMore:
    "Xisaab looma baahna.",
  faqLostFoundTitle:
    "Ma wax baad ku lumisay dugsiga?",
  faqLostFoundBody:
    "Shaqaaluhu waxay sawiraan waxa la soo celiyo oo ku dhejiyaan bogga alaabta lumay — haddii aad xisaab tusmada ku leedahayna, adiguba waxaad ku dari kartaa wax aad heshay. Qof kastaa wuu eegi karaa, waxaadna xafiiska u sheegi kartaa in shay adiga kuu leeyahay adigoon xisaab lahayn. Magacyada ku qoran alaabta weligood si guud looma muujiyo.",
  privacyNeverTitle: "Waxa aanan samayn",
  privacyNeverBody:
    "Ma iibinno oo ma wadaagno macluumaadkan, xayaysiin ma wadno, waxna halkan kuma raadraacaan: cabbirka kaliya waa tirinta booqashooyinka ee aan cookies lahayn ee kor lagu sharaxay, taas oo diiwaangelisa bogag, ee ma aha dad. Cidna lagama sameeyo profile waxbana looma diro dallaal xog.",
  privacyContactTitle: "Su\u2019aalo",
  privacyContactBody:
    "Noo soo qor, qof baana kuu jawaabi doona. Haddii aad u malaynayso in wax halkan ku qaldan yihiin, ama aad doonayso in qoyskaaga la saaro, taasi waa cinwaanka.",
  landingSchoolSiteLabel: "Ma raadinaysaa dugsiga laftiisa?",
  landingSchoolSiteLink: "Bogga Eisenhower Elementary",

  landingHelpEyebrow: "Wax fiican in la ogaado",
  landingHelpTitle: "Cidda la soo waco iyo meesha wax laga eego",
  landingContactsDistrict: "Xiriirada degmada",
  landingResourcesTitle: "Meesha wax laga eego",
  landingFactHours: "Saacadaha dugsiga",
  landingFactOffice: "Xafiiska dugsiga",
  landingFactOfficeBody: "Dugsiga laftiisa, oo ay ku jirto barnaamijka luqadda labaad.",
  landingFactInterpreters: "Turjumaan iyo tarjumaad",
  landingFactInterpretersBody:
    "Degmadu waxay siisaa turjumaanno iyo dukumiintiyo la turjumay qoysaska aan Ingiriisigu luqaddooda koowaad ahayn. Weydii Eisenhower Community Center.",
  landingDeptAthletics: "Ciyaaraha",
  landingDeptCommunityEd: "Waxbarashada Bulshada",
  landingDeptEarlyChildhood: "Carruurnimada Hore",
  landingDeptEarlyChildhoodScreening: "Baaritaanka Carruurnimada Hore",
  landingDeptHumanResources: "Shaqaalaha",
  landingDeptSchoolAgeCare: "Daryeelka carruurta dugsiga (Kids & Company)",
  landingDeptNutrition: "Nafaqada",
  landingDeptSpecialServices: "Adeegyada Gaarka ah",
  landingDeptSuperintendent: "Kormeeraha Guud",
  landingDeptTransportation: "Gaadiidka",
  landingFactEnroll: "Diiwaangelinta",
  landingFactEnrollBody:
    "Ilmo kasta oo bilaabaya xannaanada waa inuu foom soo gudbiyaa — oo ay ku jiraan dadka Hopkins deggan, walaalaha yaryar iyo carruurta dugsiga barbaarta.",
  landingFactPortal: "Bogga waalidka",
  landingFactPortalBody:
    "Xaadirinta, jadwalka, khidmadaha iyo natiijooyinka waxay ku jiraan Infinite Campus. Halkan ka codso xisaab haddii aadan lahayn, oo hubi in xogtaada xiriirku cusub tahay.",
  landingFactBuses: "Basaska",
  landingFactBusesBody:
    "Waddooyinka iyo saacadaha joogsiga waxaa iimayl lagugu soo diraa ka hor bilowga sanadka, ka dibna waxay ku jiraan bogga waalidka. Su'aalaha u dir {email}.",
  landingFactMeals: "Quraac iyo qado",
  landingFactMealsBody:
    "Waa bilaash arday kasta maalin kasta oo dugsi ah; cunto labaad iyo wax dheeraad ah waxaa laga jaraa xisaabtooda. Weli waxtar leh in la codsado kaalmada waxbarasho — waxay yaraysaa khidmadaha oo xagaaga raashin lagu caawiyo.",
  landingFactSafety: "Badbaadada",
  landingFactSafetyBody:
    "Tababarrada ay dugsi kasta oo Minnesota ku yaal sameeyo, iyo sida loo ogeysiiyo xiritaanka iyo baxa hore.",
  landingFactRoyalReport: "Warsidaha degmada",
  landingFactRoyalReportBody:
    "Royal Report, oo iimayl lagu soo diro laba toddobaad kasta inta sanad-dugsiyeedku socdo. Kayaga wuu ka duwan yahay, labaduba way mudan yihiin.",

  offlineBanner: "Offline \u2014 waxaa lagu tusayaa koobigaaga la kaydiyay",
  offlineReadOnly: "Akhris oo keliya",
  offlineNote:
    "Waad offline tahay, sidaas darteed tusmadu waa akhris oo keliya. Koobigaaga la kaydiyay ayaa la tusayaa. Dib u xiriir si aad isbeddel u samayso.",
  masqViewingAs: "Waxaad u eegaysaa sida",
  masqReturn: "Ku noqo maamulka",
  signOut: "Ka bax",

  brandSubStore: "Dukaanka",
  navStore: "Dukaanka",
  storeTitle: "Dukaanka dugsiga",
  storeLead: "Dhar dugsiga, la daabaco marka la dalbado. Iibsi kastaa wuxuu taageerayaa PTO-da.",
  storeEmpty: "Wax iib ah weli ma jiraan — dib u eeg.",
  storeFrom: "laga bilaabo {price}",
  storeSoldOut: "Waa la wada iibiyay",
  storeChooseOption: "Dooro cabbir",
  storeAddToCart: "Ku dar gaadhiga",
  storeCart: "Gaadhiga",
  storeCartEmpty: "Gaadhigaagu waa madhan yahay.",
  storeKeepShopping: "Sii wad iibsiga",
  storeQty: "Tirada",
  storeRemove: "Ka saar",
  storeSubtotal: "Wadarta hoose",
  storeShipping: "Rarid",
  storeTotal: "Wadarta",
  storeWhereTo: "Xaggee loo diro?",
  storeFullName: "Magaca oo dhan",
  storeEmail: "Iimaylka",
  storeAddress1: "Cinwaanka jidka",
  storeAddress2: "Guriga, qolka (ikhtiyaari)",
  storeCity: "Magaalada",
  storeState: "Gobolka",
  storePostalCode: "Lambarka boostada",
  storeCountry: "Dalka",
  storePhone: "Telefoon (ikhtiyaari)",
  storeGetShipping: "Eeg qaababka rarida",
  storeChooseShipping: "Dooro rarida",
  storeCheckout: "Bixi",
  storeCheckoutNote: "Waxaad si ammaan ah ugu bixin doontaa Stripe. Weligeen ma aragno kaarkaaga.",
  storeOrderTitle: "Dalabkaaga",
  storeOrderProcessing: "Waan helnay — waa la diyaarinayaa.",
  storeOrderShipped: "Waa socdaa.",
  storeOrderProblem: "Wax caawimaad u baahan ayaa jira.",
  storeOrderProblemNote:
    "Lacag bixintaadu way dhammaatay, laakiin dalabkan wuxuu u baahan yahay qof eega. Waa nala ogeysiiyay, waana kula soo xiriiri doonnaa.",
  storeTracking: "Raadraaca",
  storeOrderNotFound: "Ma helin dalabkaas.",
  storeShipTo: "Loo diro",
  storePlaced: "La dalbaday",
  storeMadeToOrder: "Waa la daabacaa marka la dalbado, sidaas darteed dhowr maalmood ka sug inta aan la dirin.",
  landingStoreBody:
    "Dharka dugsiga Eisenhower — funaanado, koodh iyo wax kale, la daabaco marka la dalbado oo albaabkaaga la keeno.",
  landingStoreMore: "Iibsi kastaa wuxuu taageerayaa PTO-da. Xisaab uma baahnid inaad wax iibsato.",

  // pto
  brandSubPto: "PTO",
  navPto: "PTO",
  ptoTitle: "Ururka Waalidiinta iyo Macallimiinta",
  ptoLead:
    "Qoys kasta oo Eisenhower ah horeyba xubin buu u yahay. PTO-du waxay ururisaa lacagta miisaaniyadda dugsigu gaadhi kari weyday, waxay qabataa munaasabadaha carruurtaadu xasuusan doonto, waxayna daryeeshaa shaqaalaha carruurta daryeela.",
  ptoWhatTitle: "Waxa PTO-du qabato",
  ptoWhatBody:
    "Eisenhower waa saddex dugsi oo hal saqaf hoos yaal — dugsiga bulshada, barnaamijka Shiinaha ee XinXing, iyo barnaamijka Isbaanishka ee Juntos — PTO-duna saddexdaba way u adeegtaa. Waxaa gebi ahaanba wada waalidiin iyo shaqaale iskaa wax u qabso ah. Ma jiro shaqo mushahar leh mana jiro xafiis; wax kasta oo hoos ku qoran waa fiid qof.",
  ptoPillarFund: "Lacag ururisa",
  ptoPillarFundBody:
    "Read-A-Thon, suuqyada buugaagta, iibka geedaha guga, Jimcayaasha salool-la'aanta, iyo Give to the Max Day. Waxa la ururiyo waxaa lagu bixiyaa safarrada waxbarasho, qalabka fasalka, meesha waxbarashada bannaanka, iyo barnaamijyo aan meel kale laga heli karin.",
  ptoPillarCommunity: "Qoysaska isu keena",
  ptoPillarCommunityBody:
    "Habeenka Garoonka, Maalinta Ciyaaraha, Bandhigga Hibada, Suuqa Male-awaalka, iyo Habeenka Bingo. Bilaash ama ku dhow, waana loo furan yahay qof walba — sidaas darteedna qoys Ogosto yimid Oktoobar wuxuu garanayaa dhawr weji.",
  ptoPillarCulture: "Saddexda barnaamij oo dhan u dabaaldega",
  ptoPillarCultureBody:
    "Sannadka Cusub ee Shiinaha, xaflada Juntos iyo xaflada sannad-gunaanadka, iyo Bandhigga Farshaxanka iyo Dhaqanka ee guga. Lambarrada Bingo waxaa waalidiintu sannad kasta ku dhawaaqaan Ingiriisi, Isbaanish iyo Shiineys.",
  ptoPillarStaff: "Shaqaalaha taageera",
  ptoPillarStaffBody:
    "Cunto maalmaha dheer ee shirarka waalidiinta, Toddobaadka Mahadnaqa Macallimiinta, qol shaqaale oo alaab buuxda, iyo casharrada Art Adventure iyo BRAVO ee waalidiintu fasallada ku dhex bixiyaan jiilaal kasta.",
  ptoBoardTitle: "Cidda maamusha",
  ptoBoardLead:
    "Guddi la doortay oo waalidiin iskaa wax u qabso ah, iyo qof kasta oo gacan taaga. Kuraasta waxaa la doortaa Oktoobar kasta, sidaas darteed boggani wuxuu magacaabayaa shaqooyinka ee ma aha dadka — magacyadu waxay ku jiraan tusmada, halkaas oo ay ku cusboonaadaan.",
  ptoRolePresident: "Guddoomiye",
  ptoRolePresidentBody:
    "Wuxuu hoggaamiyaa kulamada, isku duba ridaa munaasabadaha, ansixiyaa lacag-celinta, qabsadaa basaska iyo alaab-qeybiyeyaasha, qabtaa doorashada, wuxuuna PTO-da ka matalaa degmada.",
  ptoRoleVicePresident: "Ku-xigeenka Guddoomiyaha",
  ptoRoleVicePresidentBody:
    "Wuu wada hoggaamiyaa, wuxuuna qabtaa suuqa buugaagta, Read-A-Thon, buugga sannadka, mahadnaqa macallimiinta iyo qolka shaqaalaha.",
  ptoRoleSecretary: "Xoghaye",
  ptoRoleSecretaryBody:
    "Diiwaanka kulamada, wargeyska bishii mar ah ee PTO Corner, warqadaha, liisaska rabitaanka, iyo in sawirrada sannadka la qaado oo la wadaago.",
  ptoRoleTreasurer: "Khasnaji",
  ptoRoleTreasurerBody:
    "Warbixinta maaliyadda, miisaaniyadda, canshuuraha, kaydinta iyo lacag-celinta.",
  ptoRoleFundraising: "Hoggaamiyaha ururinta lacagta",
  ptoRoleFundraisingBody:
    "Habeennada makhaayadaha, Read-A-Thon, iibka geedaha, iyo Give to the Max Day.",
  ptoRoleVolunteer: "Hoggaamiyaha mutadawiciinta",
  ptoRoleVolunteerBody:
    "Isku duwidda iyo diiwaangelinta mutadawiciinta oo dhan, alaabta dugsiga, Habeenka Bingo, iyo mahadnaqa sannad-gunaanadka.",
  ptoRoleTeacherRep: "Wakiilka Macallimiinta",
  ptoRoleTeacherRepBody:
    "Buundada u dhaxaysa qolka macallimiinta iyo PTO-da — wuxuu keenaa baahiyaha fasalka iyo fursadaha deeqaha.",
  ptoRoleMemberAtLarge: "Xubno guud",
  ptoRoleMemberAtLargeBody:
    "Kaalinta kaydka: gacmo dabacsan iyo hoggaamiyeyaal munaasabad gaar ah, wixii sannadkan qof u baahan.",
  ptoYearTitle: "Sannadka, bil bil",
  ptoYearLead:
    "Wax kasta oo PTO-du qabato, siday u dhacaan. Taariikhuhu way beddelmaan — kalandarku had iyo jeer wuxuu hayaa kuwa ugu dambeeyay.",
  ptoYearRound: "Sannadka oo dhan, gadaasha:",
  ptoCatFundraiser: "Ururin lacag",
  ptoCatCommunity: "Bulsho",
  ptoCatCultural: "Dhaqan",
  ptoCatAppreciation: "Mahadnaq",
  ptoCatEnrichment: "Barnaamij dheeraad ah",
  ptoCatGovernance: "Kulan",
  ptoMeetingsTitle: "Kulamada",
  ptoMeetingsBody:
    "Bishii mar, badanaa 6:30 galabnimo {place}, Zoom-na waa la heli karaa. Kulanka Oktoobar waxaa lagu qabtaa doorashada guddiga. Qof walba waa lagu soo dhaweynayaa, waxba lagaama filayo, hadalna uma baahnid inaad ku dhufato.",
  ptoHelpTitle: "Siyaabaha aad ku caawin karto",
  ptoHelpLead:
    "Cidina kaama codsanayso sannad noloshaada ah. Inta badan waxa PTO-du u baahan tahay waa laba saacadood, hal mar.",
  ptoHelpMeeting: "Kulan kaalay",
  ptoHelpMeetingBody:
    "Bishii mar, qiyaastii saacad, waana habka ugu dhaqsaha badan ee aad ku ogaan karto waxa dhab ahaan socda.",
  ptoHelpWishlist: "Wax soo dir",
  ptoHelpShop: "Iibso shaadhka",
  ptoHelpShopBody:
    "Dharka dugsiga oo laga helo dukaanka PTO-da. Dalab kastaa wuxuu taageeraa dugsiga, xisaabna uma baahnid.",
  ptoHelpMoreCta: "Siyaabo kale oo lagu caawiyo",
  ptoOnThisPage: "Boggan dhexdiisa",
  ptoHowResourceTitle: "Xarunta Kheyraadka",
  ptoHowResourceLead:
    "Marka qoys Eisenhower ah uu wakhti adag soo maro, Xarunta Kheyraadka ayaa ah sida dugsigu u caawiyo — si degdeg ah oo aamusnaan ah.",
  ptoHowResourceWhat: "Waxa lacagta lagu bixiyo",
  ptoHowResourceWhatBody:
    "Cunto cusub, raashin, jaakado iyo kabo jiilaal, iyo kaararka hadiyadda ee waxyaabaha lagama maarmaanka ah — waxyaabaha bil adag si lama filaan ah ugu baahato.",
  ptoHowResourceWho: "Sida ay qoys u gaarto",
  ptoHowResourceWhoBody:
    "Shaqaalaha dugsiga ayaa baahida marka hore arka, codsi kastana si shakhsi ah oo qarsoodi ah ayay u maareeyaan. Foom gaaban — ama hadal aamusan — ayaa ku filan, liis cid kale aqrisaana ma jiro. Qaybta PTO-du waa inaysan lacagtu weligeed dhammaan.",
  ptoHowResourceVolunteer: "Ka caawi socodsiinta",
  ptoHowResourceVolunteerBody:
    "Mutadawiciin joogto ah ayaa wax soo iibsada oo khaanadaha buuxiya oo hagaajiya — laba saacadood toddobaadkii. Wardiyada soo socda oo dhan waxay ku qoran yihiin xaashida isqorista; ka dooro mid kugu habboon.",
  ptoHowResourceGive: "Sida wax loo bixiyo",
  ptoHowResourceGiveBody:
    "Ku deeq dukaanka Square ee PTO-da, ama xafiiska hore ku dhaaf lacag caddaan ah ama jeeg ku qoran “Resource Center”.",
  ptoHowResourceNoteTitle: "Ma u baahan tahay caawimaad?",
  ptoHowResourceNoteBody:
    "Buuxi foomka codsiga caawinta, ama wac Xarunta Kheyraadka. Qofna PTO-da kama ogaan doono cidda codsatay, waxbana laguguma lahan — tani waxay u taagan tahay sidaas oo kale.",
  ptoHowResourceFormCta: "Foomka codsiga caawinta",
  ptoResourceFeaturedTag: "Waxa hadda loo baahan yahay",
  ptoResourceFeaturedTitle: "Ururinta dharka jiilaalka",
  ptoResourceFeaturedBody:
    "Xarunta Kheyraadku waxay ururinaysaa jaakadaha jiilaalka iyo dharka qabowga — surwaallo, funaanado dhaxan iyo kuwo la mid ah — cabbirrada carruurta iyo kuwa dadka waaweynba. Deeqda ku rid sanduuqa xafiiska hore ee ku calaamadeysan “WINTER GEAR DRIVE”.",
  ptoResourceDonateTitle: "Siyaabaha wax loogu deeqo",
  ptoResourceGiftCards: "Kaararka hadiyadda",
  ptoResourceGiftCardsBody:
    "Kaadh hadiyadeed oo raashin, shidaal ama dhar ah wuxuu qoyska u oggolaanayaa inay caawimada geliyaan meesha bishoodu ugu baahan tahay. Mid ku qoran “Resource Center” xafiiska hore ku dhaaf, ama soo wac si loo qabanqaabiyo.",
  ptoResourceSquare: "Lacag ku deeq",
  ptoResourceSquareBody:
    "Deeq lacageed oo toos ah oo loo maro dukaanka PTO-da ayaa isla markiiba shaqo gasha — qaddar kasta, akoonna looma baahna. Waxaad sidoo kale xafiiska hore ku dhaafi kartaa lacag caddaan ah ama jeeg ku qoran “Resource Center”.",
  ptoResourceSquareCta: "Fur dukaanka PTO-da",
  ptoResourceSignupCta: "Dooro wardi",
  ptoHowVolunteerOpen: "Waxa hadda caawimaad u baahan",
  ptoHowVolunteerRecurring: "Kuwa sannad kasta soo noqnoqda:",
  ptoHowWishlistTitle: "Liisaska rabitaanka macallimiinta",
  ptoHowWishlistLead:
    "Macallimiintu jeebkooda ayay kaga bixiyaan kharashka fasalka in ka badan inta qofna qirto. Liis rabitaan ayaa hal shay kaga qaadaya garbahooda: dalbo shaygaas, wuxuuna yimaadaa dugsiga.",
  ptoHowWishlistOpen: "Fur liiska",
  ptoHowWishlistLounge: "Qolka shaqaalaha",
  ptoHowWishlistLoungeBody:
    "Kafee, shaah iyo cunto fudud oo loogu talagalay dadka ka hor yimaada carruurtaada. Kani waa liiska ka dambeeya “Stock the Staff Lounge”.",
  ptoHowWishlistArt: "Qolka farshaxanka",
  ptoHowWishlistArtBody:
    "Qalabka uu qolka farshaxanku ugu dhaqsaha badan isticmaalo, cabbirrada uu dhab ahaan u isticmaalona.",
  ptoHowWishlistFrcBody:
    "Alaabta aasaasiga ah ee khaanadaha Xarunta Kheyraadka — cunto, alaabta nadaafadda iyo waxyaabo kale oo lagama maarmaan ah, oo si toos ah dugsiga loogu keeno.",
  ptoHowWishlistClassTitle: "Liisaska fasallada",
  ptoHowWishlistClassLead:
    "Macallimiintuna waxay hayaan liisas u gaar ah. Raadi fasalka ilmahaaga oo hal shay dalbo — wuxuu yimaadaa dugsiga.",
  ptoHowWishlistFilter: "Ku kala shaandhee macallin ama fasal",
  ptoHowWishlistFilterNone: "Waxba isma waafaqsana — isku day xarfo ka yar.",
  ptoHowWishlistNoteTitle: "Ma arkaysid macallinkaaga?",
  ptoHowWishlistNoteBody:
    "Liisaska waxaa lagu daraa marka macallimiintu la wadaagaan — wargeyska, kulamada waalidka, ama email loogu diro PTO-da.",
  ptoDonateTitle: "Deeq bixi",
  ptoDonateLead:
    "PTO-da gebi ahaanba waxaa wada mutadawiciin, sidaas darteed wixii la deeqo waxay ku soo laabtaan dugsiga iyagoo ku dhawaad dhammaystiran — safarrada waxbarasho, qalabka fasalka, meesha waxbarashada bannaanka, iyo barnaamijyada dheeraadka ah.",
  ptoDonateCta: "Ku deeq GiveMN",
  ptoDonateNote:
    "GiveMN waa madal deeq oo Minnesota ah oo loogu talagalay ururrada aan faa'iido doonka ahayn, waana meesha PTO-du Nofeembar kasta ku qabato ololaha Give to the Max Day. Maalin kasta oo sannadka ka mid ah ayaad halkaas ku deeqi kartaa.",
  ptoFindTitle: "Halka naga heli karto",
  ptoFindLead:
    "Su'aal, fikrad, ama saacad aad hayso — mid kasta oo kuwan ka mid ah wuxuu gaadhayaa qof dhab ah.",
  ptoOrgTitle: "Ururka samafalka",
  ptoOrgEin: "EIN (lambarka canshuurta)",
  ptoOrgNote:
    "PTO-du waa urur samafal oo madaxbannaan oo ay wadaan waalidiinta dugsiga. Boostadu waxay ku timaaddaa cinwaanka dugsiga, barnaamijka shirkaddu ku barbardhigto deeqdaaduna wuxuu ku weydiin doonaa EIN-ka.",
  ptoNoAccessTitle: "Qaybtan waxaa leh guddiga PTO-da",
  ptoNoAccessBody:
    "Boodhadhka qorshaynta waa meesha PTO-du munaasabadaheeda ku abaabusho, waxayna u furan yihiin dadka ku jira liiska guddiga. Wax kasta oo kale oo goobtan ku jira adigaa u furan.",
  ptoNoAccessNote:
    "Haddaad u malaynayso inaad heli lahayd, weydii xubin guddiga ka mid ah — ama kaalay kulanka xiga, taasoo dhab ahaan ah sida dadka intooda badani halkan ku yimaadaan.",
  landingPtoBody:
    "Cidda PTO-du tahay, waxa ay sannadka oo dhan qabato, iyo sida aad saacad ugu deeqi karto ama lacag u bixin karto.",
  landingPtoMore:
    "Qoys kastaa horeyba xubin buu u yahay. Waxba lama saxiixo, xisaabna looma baahna.",
  landingFrcMore:
    "Codsashadu waa qarsoodi, deeq bixintuna hal daqiiqad bay qaadataa. Xisaab looma baahna.",
  // Lost & found (apps/lostandfound). Category and colour names translate the
  // fixed vocabularies LF_CATEGORIES / LF_COLORS for display only — the stored
  // value stays English, since it is what the model and the filters speak.
  navLostFound: "Alaabta Lumay",
  brandSubLostFound: "Alaabta Lumay",
  lfNavBrowse: "Daawo",
  lfNavStaff: "Shaqaalaha",
  lfBrowseTitle: "Wax ma kaa lumay?",
  lfBrowseLead: "Wax kasta oo dugsiga lagu soo celiyay, sawir leh. Ma heshay kaaga? Fur oo taabo “Waa kayga!”",
  lfLabelTip: "Waalidiinta Eisenhower waxay natiijo wanaagsan ka heleen istiikarradan maro ah si ay alaabtooda u calaamadeeyaan",
  lfItemCountOne: "1 shay ayaa sugaya qofkii lahaa.",
  lfItemCount: "{n} shay ayaa sugaya dadkii lahaa.",
  lfCounts: "{found}, {returned}.",
  lfCountsFoundOne: "1 shay oo la helay",
  lfCountsFound: "{n} shay oo la helay",
  lfCountsReturnedOne: "1 loo celiyay qofkii lahaa",
  lfCountsReturned: "{n} loo celiyay dadkii lahaa",
  lfSearchPlaceholder: "Isku day “dhalo biyo buluug ah” ama “funaanad dinosaur”",
  lfSearchLabel: "Raadi alaabta la helay",
  lfAllCategories: "Dhammaan noocyada",
  lfCategoryLabel: "Nooca",
  lfColorLabel: "Midabka",
  lfBestMatches: "Natiijooyinka ugu fiican ee “{q}”",
  lfNoMatches: "Wax la helay ma jiraan. Isku day erayo yar, ama ka saar shaandhada.",
  lfEmpty: "Hadda waxba ma jiraan.",
  lfShowMore: "Tus wax badan",
  lfDescribing: "Waa la sharraxayaa…",
  lfFoundToday: "Maanta la helay",
  lfFoundYesterday: "Shalay la helay",
  lfFoundDaysAgo: "La helay {n} maalmood ka hor",
  lfLoadError: "Alaabta lama soo dejin karin. Hubi xiriirkaaga oo mar kale isku day.",
  lfItemGone: "Alaabtan hadda kuma jirto liiska. Waxaa laga yaabaa in loo celiyay qofkii lahaa.",
  lfBackToAll: "Dhammaan alaabta",
  lfFactCategory: "Nooca",
  lfFactColors: "Midabada",
  lfFactBrand: "Summadda",
  lfFactMaterial: "Walaxda",
  lfFactWhere: "Halka laga helay",
  lfFactFound: "Taariikhda la helay",
  lfAutoDescribed: "Sharaxaadda si toos ah ayaa looga sameeyay sawirka (Ingiriisi).",
  lfZoomIn: "Weyneey",
  lfZoomOut: "Yaree",
  lfZoomReset: "Dib u celi",
  lfZoomHint: "Sawirka ku taabo laba jeer ama farahaaga isku soo dhaaf si aad u weyneyso, kadibna jiid si aad u eegto.",
  lfPendingNote: "Weli waxaan qoraynaa sharaxaadda alaabtan.",
  lfClaimTitle: "Ma adigaa leh?",
  lfClaimLead: "U sheeg xafiiska, waana kuu kaydin doonaan.",
  lfClaimCta: "Waa kayga!",
  lfClaimName: "Magacaaga",
  lfClaimContact: "Iimayl ama telefoon",
  lfClaimChild: "Magaca ilmahaaga (ikhtiyaari)",
  lfClaimTeacher: "Macallinka ilmahaaga (ikhtiyaari)",
  lfClaimMessage: "Sideed ku ogtahay inuu kaaga yahay? (ikhtiyaari)",
  lfClaimMessageHint: "Tusaale: hoosta ayuu ka godan yahay, ama stiikar ayuu leeyahay",
  lfClaimSend: "U dir xafiiska",
  lfClaimSending: "Waa la dirayaa…",
  lfClaimThanksTitle: "Mahadsanid!",
  lfClaimThanksBody: "Xafiisku wuu helay fariintaada, wayna kula soo xiriiri doonaan. Sidoo kale waxaad ka qaadan kartaa meesha alaabta lumay.",
  lfClaimError: "Lama dirin. Hubi magacaaga iyo xiriirkaaga, kadibna mar kale isku day.",
  lfClaimPrivacy: "Shaqaalaha dugsiga oo keliya ayaa arka waxa aad halkan ku qorto.",
  lfClaimContactHint: "Iimayl ayaa ugu fiican — waxaan si toos ah kuugu soo diri karnaa ogeysiis marka la soo celiyo.",
  lfReturnSubject: "Alaabtaadii lumay waa soo socotaa: {item}",
  lfReturnBodyClassroom: "War wanaagsan — “{item}” oo ka socota alaabta lumay ee {school} waxaa guriga loogu soo diray fasalka ilmahaaga.",
  lfReturnBodyOffice: "War wanaagsan — “{item}” oo ka socota alaabta lumay ee {school} waxay kugu sugaysaa xafiiska hore ee dugsiga.",
  lfReturnBodyFamily: "War wanaagsan — “{item}” oo ka socota alaabta lumay ee {school} waxaa loo celiyay qoyskaaga.",
  lfReturnClosing: "Haddii aysan soo gaarin, ama arrintu sax kula ahayn, la xiriir xafiiska {school}.",
  lfReturnItemFallback: "alaabta aad sheegatay",
  lfStaffEdit: "Wax ka beddel shaygan",
  lfSignInToAdd: "Wax ma heshay? Gal si aad ugu darto",
  lfNavSubmit: "Ku dar",
  lfSubmitTitle: "Ku dar shay la helay",
  lfSubmitLead: "Wax ma ka heshay dugsiga? Sawir qaad — hal shay sawirkiiba, shayga oo keliya ha ku jiro — kadibna soo dir. Xafiisku wuu eegaa shay kasta ka hor inta uusan halkan ka muuqan.",
  lfSubmitLocation: "Xaggee baad ka heshay? (ikhtiyaari)",
  lfSubmitLocationHint: "Waxay khusaysaa dhammaan sawirrada dufcaddan.",
  lfSubmitPlaceholder: "tus. Jimicsiga, garoonka, maqaayadda",
  lfSubmitChoose: "Sawir qaad ama dooro sawirro",
  lfSubmitAddMore: "Ku dar sawirro kale",
  lfSubmitChooseHint: "Hal mar dhowr dooro, ama mid mid u qaad. Taabo ↻ kuwa gees u soo baxay.",
  lfSubmitNotice: "Magacyada iyo summadaha ka jeedi kamaradda — xafiisku wuu eegaa shay kasta ka hor inta aan la faafin.",
  lfSubmitOne: "Dir 1 shay",
  lfSubmitMany: "Dir {n} shay",
  lfSubmitClear: "Tirtir",
  lfSubmitPreparing: "Diyaarinaya {n}…",
  lfSubmitWaiting: "Sugaya in la geeyo…",
  lfSubmitUploading: "Waa la gelinayaa…",
  lfSubmitDone: "Waa la diray — xafiisku wuu eegi doonaa ka hor inta uusan muuqan.",
  lfSubmitFailed: "Gelintu way fashilantay. Hubi xiriirka oo mar kale isku day.",
  lfSubmitReadError: "Biraawsarkan ma akhriyi karo “{name}”. Isku day inaad kamaradda ku qaaddo.",
  lfSubmitRotateError: "Lama wareejin karin “{name}”.",
  lfNoAccessTitle: "Qaybtan waxaa iska leh shaqaalaha dugsiga",
  lfNoAccessBody: "Maaraynta codsiyada iyo faafinta alaabta waxaa qabta shaqaalaha maamula alaabta lumay. Qof kasta wuu daawan karaa, xubin kasta oo gashayna waxay ku dari kartaa wax ay heshay.",
  lfNoAccessNote: "Haddii aad caawiso alaabta lumay oo aadan geli karin, weydii xafiiska dugsiga.",
  lfCatWaterBottle: "Dhalo biyo",
  lfCatLunchBox: "Sanduuqa qadada",
  lfCatJacket: "Jaakad ama koor",
  lfCatSweatshirt: "Funaanad",
  lfCatClothing: "Dhar kale",
  lfCatWinterWear: "Koofiyad, gacmo-gashi ama masar",
  lfCatShoes: "Kabo ama buudh",
  lfCatBag: "Boorso dhabarka ama bac",
  lfCatElectronics: "Qalab elektaroonig ah",
  lfCatGlasses: "Muraayadaha indhaha",
  lfCatJewelry: "Dahab ama qurxin",
  lfCatToy: "Alaab ciyaareed",
  lfCatSchoolSupplies: "Buug ama qalabka dugsiga",
  lfCatSports: "Qalabka isboortiga",
  lfCatOther: "Kale",
  lfColorBlack: "madow",
  lfColorWhite: "caddaan",
  lfColorGray: "cawl",
  lfColorSilver: "lacageed",
  lfColorRed: "casaan",
  lfColorPink: "casaan khafiif ah",
  lfColorOrange: "oranji",
  lfColorYellow: "jaalle",
  lfColorGold: "dahabi",
  lfColorGreen: "cagaar",
  lfColorBlue: "buluug",
  lfColorNavy: "buluug madow",
  lfColorPurple: "buluug-casaan",
  lfColorBrown: "bunni",
  lfColorTan: "bunni khafiif ah",
  lfColorMulticolor: "midabbo badan",

  bingoViewOnly: "Daawasho kaliya — gal si aad looxa u maamusho",
  bingoSignInTitle: "Gal si aad looxa bingo u maamusho",
  bingoSyncError: "Khadku wuu maqan yahay — looxu wuu is cusboonaysiin doonaa marka xiriirku soo noqdo.",

  bingoScanTitle: "Hubinta kaararka",
  bingoScanAlign: "Kaarka geli gudaha sanduuqa, telefoonkana siman u hay",
  bingoScanReading: "Kaarka waa la akhrinayaa — xasili kamerada ({done}/{total})",
  bingoScanBingo: "BINGO — kaarkan waa guuleystay!",
  bingoScanClean: "Dhammaan meelaha la daboolay waa la yeeray. Weli bingo ma jiro.",
  bingoScanFalseMarks: "La daboolay laakiin aan la yeerin: {nums}",
  bingoScanMissed: "La yeeray laakiin aan la daboolin: {nums}",
  bingoScanCamera: "Kamerada lama heli karo — ogolow kamerada kadibna isku day mar kale.",
  bingoScanPhoto: "Ka hubi sawir",
  bingoScanFixHint: "Taabo sanduuq si aad u saxdo lambar si khaldan loo akhriyay.",
  bingoScanNext: "Kaarka xiga",
};

export const dictionaries: Record<Locale, Strings> = { en, es, zh, so };

/** Maps a Capability enum to its i18n dictionary key, so labels stay translated
 *  (never raw enum strings like "household_admin"). */
export const capabilityLabelKeys: Record<Capability, keyof Strings> = {
  parent: "capParent",
  teacher: "capTeacher",
  staff: "capStaff",
  student: "capStudent",
  household_admin: "capHouseholdAdmin",
};

export const localeNames: Record<Locale, { native: string; english: string }> = {
  en: { native: "English", english: "English" },
  es: { native: "Español", english: "Spanish" },
  zh: { native: "中文", english: "Chinese (Simplified)" },
  so: { native: "Soomaali", english: "Somali" },
};

// ── Language deep links ─────────────────────────────────────────────────────

/** The query parameter a language deep link carries: `?lang=so`.
 *
 *  It exists so a link can be handed to someone in the language they actually
 *  read — "here is the calendar in Somali" — without their having to find the
 *  language picker first. It is a one-shot instruction rather than a permanent
 *  part of the URL: an app applies it, remembers the choice the same way the
 *  picker would, and strips the parameter, so what stays in the address bar (and
 *  in anything bookmarked or re-shared from it) is the ordinary link. That also
 *  means these URLs need no route of their own — every existing path already
 *  accepts one. */
export const LOCALE_PARAM = "lang";

/** Resolve a BCP-47 language tag to one of our locales, or null.
 *
 *  Matches on the primary subtag only and case-insensitively, so `so`, `so-SO`,
 *  `SO_so` and `zh-Hans` all land where a reader would expect. Used for both the
 *  deep-link parameter and `navigator.language`, so a hand-typed code and a
 *  browser setting are interpreted by the same rule.
 *
 *  Anything unrecognized is null, never English: the caller's own fallback chain
 *  (saved choice, then browser language) is a better answer than a typo. */
export function localeFromTag(tag: string | null | undefined): Locale | null {
  if (!tag) return null;
  const code = tag.trim().toLowerCase().split(/[-_]/)[0];
  return LOCALES.find((l) => l === code) ?? null;
}

/** The locale named by a URL's query string, if it names one at all. Takes
 *  `location.search` (with or without its leading "?").
 *
 *  Parsed by hand rather than with URLSearchParams because this module is
 *  imported by the Worker as well as the browser, and its tsconfig deliberately
 *  carries no DOM lib. A malformed percent-escape is treated as "no locale"
 *  rather than thrown, since this runs on the boot path of every page. */
export function localeFromSearch(search: string): Locale | null {
  for (const pair of search.replace(/^\?/, "").split("&")) {
    const eq = pair.indexOf("=");
    if ((eq === -1 ? pair : pair.slice(0, eq)) !== LOCALE_PARAM) continue;
    const raw = eq === -1 ? "" : pair.slice(eq + 1).replace(/\+/g, " ");
    try {
      return localeFromTag(decodeURIComponent(raw));
    } catch {
      return null;
    }
  }
  return null;
}

/** Interpolate `{placeholder}` tokens in a string. */
export function interpolate(
  template: string,
  vars: Record<string, string | number> = {},
): string {
  return template.replace(/\{(\w+)\}/g, (_, k: string) =>
    k in vars ? String(vars[k]) : `{${k}}`,
  );
}
