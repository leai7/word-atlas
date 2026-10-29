/**
 * Common irregular forms, so a chunk written in its base form ("give up") is still found
 * in a sentence that uses another form ("gave up"). Each line: base, then its other forms.
 * Regular endings (-s, -ed, -ing) are matched by spelling and need no entry.
 */
const TABLE = `
arise arose arisen arising
awake awoke awoken
be am is are was were been being
bear bore born borne
beat beaten
become became becoming
begin began begun beginning
bend bent
bet betting
bind bound
bite bit bitten biting
bleed bled
blow blew blown
break broke broken
breed bred
bring brought
build built
burn burnt
buy bought
catch caught
choose chose chosen choosing
cling clung
come came coming
creep crept
cut cutting
deal dealt
dig dug digging
do does did done doing
draw drew drawn
dream dreamt
drink drank drunk
drive drove driven driving
dwell dwelt
eat ate eaten
fall fell fallen
feed fed
feel felt
fight fought
find found
flee fled
fly flew flown flies
forbid forbade forbidden
forget forgot forgotten forgetting
forgive forgave forgiven
freeze froze frozen
get got gotten getting
give gave given giving
go goes went gone going
grind ground
grow grew grown
hang hung
have has had having
hear heard
hide hid hidden hiding
hit hitting
hold held
hurt
keep kept
kneel knelt
know knew known
lay laid
lead led
lean leant
leap leapt
leave left leaving
lend lent
let letting
lie lay lain lying
light lit
lose lost losing
make made making
mean meant
meet met
mislead misled
mistake mistook mistaken
outgrow outgrew outgrown
overcome overcame overcoming
overtake overtook overtaken
overthrow overthrew overthrown
pay paid
prove proven
put putting
quit quitting
ride rode ridden riding
ring rang rung
rise rose risen rising
run ran running
say said
see saw seen
seek sought
sell sold
send sent
set setting
sew sewn
shake shook shaken shaking
shine shone
shoot shot
show shown
shrink shrank shrunk
shut shutting
sing sang sung
sink sank sunk
sit sat sitting
sleep slept
slide slid sliding
speak spoke spoken
speed sped
spend spent
spill spilt
spin spun spinning
spit spat
split splitting
spoil spoilt
spread
spring sprang sprung
stand stood
steal stole stolen
stick stuck
sting stung
stink stank stunk
strike struck stricken striking
strive strove striven striving
swear swore sworn
sweep swept
swell swollen
swim swam swum swimming
swing swung
take took taken taking
teach taught
tear tore torn
tell told
think thought
throw threw thrown
tread trod trodden
undergo undergoes underwent undergone
understand understood
undertake undertook undertaken undertaking
uphold upheld
upset upsetting
wake woke woken waking
wear wore worn
weave wove woven
weep wept
win won winning
wind wound
withdraw withdrew withdrawn
withhold withheld
withstand withstood
write wrote written writing
child children
man men
woman women
person people
foot feet
tooth teeth
mouse mice
goose geese
phenomenon phenomena
criterion criteria
datum data
medium media
`;

const FORMS = new Map<string, Set<string>>();
for (const line of TABLE.trim().split("\n")) {
  const [base, ...rest] = line.trim().split(/\s+/);
  FORMS.set(base, new Set([base, ...rest]));
}

/** Other spellings of a base word, or undefined when it is regular or unknown. */
export const irregularForms = (base: string) => FORMS.get(base.toLowerCase());
