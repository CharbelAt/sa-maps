// Original dialogue written for SA Maps (fan parody). Not taken from the game script.
// Kept short on purpose: directions first, a little flavor, no idle chatter.
// `wrong_turn` is Big Smoke's line every time you leave the route (user request).

export const LINES = {
  depart_now: {
    cj: [
      "Seatbelt on? Cool. Now {action}.",
      "Easy start, homie. Just {action}.",
    ],
    smoke: [
      "Roll out, homie, and {action}.",
      "Listen to me, CJ. First, {action}.",
    ],
  },
  turn_prepare: {
    cj: [
      "In {dist}, you gonna {action}.",
      "Look alive, homie. In {dist}, {action}.",
      "Coming up in {dist}, get ready to {action}.",
      "Aight, {dist} up ahead, {action}.",
      "In about {dist}, I need you to {action}.",
    ],
    smoke: [
      "Listen to me, CJ. {dist} from here, {action}.",
      "In {dist}, CJ, you're gonna {action}. Trust me.",
      "Prepare yourself, CJ. In {dist}, {action}.",
      "Okay homie, about {dist} ahead, {action}.",
      "Mark my words, CJ. In {dist}, {action}.",
    ],
  },
  turn_now: {
    cj: [
      "Now, homie, {action}.",
      "This one, homie, {action}.",
      "Hang a {dir}, man.",
      "Go on, {action}.",
      "Here it is, {action}.",
    ],
    smoke: [
      "Now, CJ, {action}!",
      "Here, CJ, {action}.",
      "Do it now, homie, {action}.",
      "Okay, okay, {action}!",
      "Now, homie, {action}. Beautiful.",
    ],
  },
  sharp_prepare: {
    cj: [
      "Tight one coming, homie. In {dist}, {action}.",
      "In {dist}, {action}. That's a hairpin, man.",
      "Ease off the gas, dawg. In {dist}, {action}.",
      "Hell of a corner coming. In {dist}, {action}.",
    ],
    smoke: [
      "Sharp turn ahead, homie. In {dist}, {action}.",
      "In {dist}, {action}. Sharp like my appetite, CJ.",
      "Get ready, CJ. In {dist}, you gotta {action}.",
    ],
  },
  sharp_now: {
    cj: [
      "Go {dir}, nice and slow.",
      "Now, homie, {action}. Easy.",
      "Hard one, homie, {action}.",
      "Here, {action}. Careful.",
      "Tight corner, dawg. Go {dir}.",
    ],
    smoke: [
      "Now, CJ, {action}! Careful!",
      "Here it is, CJ, {action}.",
    ],
  },
  slight_prepare: {
    cj: [
      "In {dist}, {action}. Just a little one.",
      "Small move in {dist}, homie, {action}.",
      "In about {dist}, {action}. Barely a turn, man.",
      "Ain't much to it. In {dist}, {action}.",
      "Coming up in {dist}, {action}. Nice and smooth.",
    ],
    smoke: [
      "Little adjustment in {dist}, homie, you {action}.",
      "In {dist}, {action}. Subtle, CJ, like good seasoning.",
      "CJ, in {dist}, {action}. Don't overthink it.",
      "Listen, in {dist}, {action}. Just a nudge, homie.",
      "In {dist}, homie, {action}. Easy does it.",
    ],
  },
  slight_now: {
    cj: [
      "Ease {dir} here, homie.",
      "Now, {action}. Just a little.",
      "Bear {dir}, man.",
      "Little one here, {action}.",
      "Go {dir}, real smooth.",
    ],
    smoke: [
      "Bear {dir}, homie. Gentle.",
      "Go {dir} here, CJ.",
      "Here, {action}. Smoke approves.",
    ],
  },
  uturn_prepare: {
    cj: [
      "Damn, wrong way. In {dist}, {action}.",
      "In {dist}, {action}. Don't ask me how.",
      "Okay, in {dist}, {action}. When it's safe, homie.",
      "Heads up, in {dist}, you gonna {action}.",
      "In {dist}, {action}. Only where it's legal, man.",
    ],
    smoke: [
      "Sometimes forward is backward, CJ. In {dist}, {action}.",
      "In {dist}, homie, {action}. I forgot something anyway.",
    ],
  },
  uturn_now: {
    cj: [
      "Aight, {action} when it's clear.",
      "When it's safe, homie, {action}.",
      "Okay, {action}. Check your mirrors.",
      "This spot works, so {action}.",
      "Go ahead and {action}, homie.",
    ],
    smoke: [
      "Now, CJ, {action}. Carefully.",
      "When it's clear, CJ, {action}.",
      "Do it here, CJ, {action}.",
    ],
  },
  merge_far: {
    cj: [
      "Way up ahead, about {dist}, you gonna {action}.",
      "No rush, homie. In {dist}, {action}.",
      "Just so you know, in {dist}, {action}.",
      "In {dist}, {action}. Plenty of time, man.",
      "Keep cruising. In about {dist}, {action}.",
    ],
    smoke: [
      "CJ, in {dist}, {action}. Plan ahead, like lunch.",
      "Far ahead, homie, about {dist}, {action}.",
      "Mark it down, CJ. In {dist}, {action}.",
      "In {dist}, {action}. A smart man thinks ahead.",
      "Relax, homie. In {dist}, you'll {action}.",
    ],
  },
  merge_prepare: {
    cj: [
      "In {dist}, {action}. Check your mirror, homie.",
      "Merge coming in {dist}. Get ready to {action}.",
      "In {dist}, {action}. Find your gap, man.",
      "Eyes up, dawg. In {dist}, {action}.",
      "Signal on soon. In {dist}, {action}.",
    ],
    smoke: [
      "Merging is about trust, CJ. In {dist}, {action}.",
      "In {dist}, CJ, {action}. Find your spot.",
      "Focus up, homie. In {dist}, {action}.",
      "In {dist}, {action}. Patience, CJ, patience.",
    ],
  },
  merge_now: {
    cj: [
      "Merge {dir}, homie.",
      "Okay, {action}. Smooth.",
      "Find your gap and {action}.",
      "Now, dawg, {action}.",
      "Signal and go {dir}.",
    ],
    smoke: [
      "Now, CJ, {action}. Blend in.",
      "Merge {dir}, homie, like butter.",
      "Ease on in, CJ, {action}.",
      "Go on, homie, {action}. Easy.",
    ],
  },
  ramp_far: {
    cj: [
      "Freeway's coming, homie. In {dist}, {action}.",
      "In {dist}, {action}. We hitting the highway.",
      "Big road ahead, man. In {dist}, {action}.",
      "In about {dist}, {action}. Big road time.",
      "Just a warning, dawg. In {dist}, {action}.",
    ],
    smoke: [
      "CJ, the freeway calls. In {dist}, {action}.",
      "Think ahead, CJ. In {dist}, {action}.",
      "In {dist}, homie, {action}. Big road, big dreams.",
      "Prepare your mind, CJ. In {dist}, {action}.",
      "About {dist} ahead, {action}. Smoke has spoken.",
    ],
  },
  ramp_prepare: {
    cj: [
      "In {dist}, {action}. On-ramp's coming up.",
      "Get ready, homie. In {dist}, {action}.",
      "Ramp in {dist}, dawg. You gonna {action}.",
      "In {dist}, {action}, then match the flow.",
      "Okay, in {dist}, {action}. Don't miss it.",
    ],
    smoke: [
      "In {dist}, {action}, CJ. Up we go.",
      "Listen to me, homie. In {dist}, {action}.",
      "Get ready, CJ. {dist} out, {action}.",
      "In {dist}, {action}. Easy on, easy flow.",
      "Okay homie, in {dist}, {action}. Freeway time.",
    ],
  },
  ramp_now: {
    cj: [
      "Here's the ramp, {action}.",
      "Now, dawg, {action}. Freeway's waiting.",
      "Aight, {action}. Freeway time.",
      "This is it, dawg, {action}.",
      "Okay, {action}, then merge smooth.",
    ],
    smoke: [
      "Here, homie, {action}. Destiny awaits.",
      "Take it, CJ, {action}.",
      "This one, CJ, {action}. Beautiful.",
      "Okay okay, {action}. Smooth.",
      "Now, {action}, homie. Graceful.",
    ],
  },
  exit_far: {
    cj: [
      "Our exit's coming, homie. In {dist}, {action}.",
      "In {dist}, {action}. Start moving over soon.",
      "Remember this, dawg. In {dist}, {action}.",
      "In about {dist}, {action}. Almost off this freeway.",
      "Freeway's almost done with us. In {dist}, {action}.",
    ],
    smoke: [
      "Keep it in mind, CJ. In {dist}, {action}.",
      "About {dist} from here, {action}. Smoke is watching.",
    ],
  },
  exit_prepare: {
    cj: [
      "In {dist}, {action}. Signal early, homie.",
      "Exit in {dist}, dawg. You gonna {action}.",
      "Okay, in {dist}, {action}. We getting off.",
      "Get ready, man. In {dist}, {action}.",
    ],
    smoke: [
      "Listen, homie. In {dist}, {action}.",
      "Exit coming, CJ. In {dist}, {action}.",
      "In {dist}, {action}. I smell a drive-thru, homie.",
      "Okay CJ, {dist} to go, then {action}.",
    ],
  },
  exit_now: {
    cj: [
      "Here's our exit, {action}.",
      "This is us, homie, {action}.",
      "Exit time, dawg, {action}.",
      "Okay, {action}. Bye, freeway.",
      "Take it here, man, {action}.",
    ],
    smoke: [
      "Now, CJ, {action}. Farewell, freeway.",
      "Here, CJ, {action}. Gently.",
      "The exit, CJ, {action}!",
    ],
  },
  fork_far: {
    cj: [
      "Fork coming way up, homie. In {dist}, {action}.",
      "In {dist}, {action}. Remember that one.",
      "Road splits in {dist}, man. You gonna {action}.",
      "Plan ahead, dawg. In {dist}, {action}.",
      "Still a ways out, but in {dist}, {action}.",
    ],
    smoke: [
      "In {dist}, {action}. A fork, like at dinner.",
      "Remember, CJ. In {dist}, {action}.",
      "About {dist} ahead, homie, {action}. Choose wisely.",
    ],
  },
  fork_prepare: {
    cj: [
      "Fork in {dist}, homie, so {action}.",
      "In {dist}, {action}. Don't hesitate.",
      "Okay, road splits in {dist}, and you {action}.",
      "Split's coming, dawg. In {dist}, {action}.",
      "In {dist}, {action}. Pick your lane early.",
    ],
    smoke: [
      "In {dist}, CJ, {action}. Two roads, one Smoke.",
      "A fork in {dist}, homie, so {action}.",
      "In {dist}, {action}. Decisions, CJ, decisions.",
    ],
  },
  fork_now: {
    cj: [
      "Stay {dir} here, homie.",
      "Now, {action}.",
      "Take the {dir} side, dawg.",
      "This is the split, {action}.",
      "Okay man, go {dir}.",
    ],
    smoke: [
      "Now, homie, {action}. Choose destiny.",
      "Stay {dir}, CJ. Trust me.",
      "Take the {dir} road, homie.",
    ],
  },
  keep_prepare: {
    cj: [
      "In {dist}, homie, {action}.",
      "Coming up in {dist}, {action}. Easy.",
      "Heads up, man. In {dist}, {action}.",
      "Okay dawg, {dist} out, {action}.",
      "In {dist}, {action}. Nothing crazy.",
    ],
    smoke: [
      "In {dist}, CJ, {action}. Stay on the path.",
      "Listen, homie, {dist} from here, {action}.",
      "In {dist}, {action}. Consistency, CJ, is the secret.",
      "In {dist}, homie, {action}. Easy money.",
      "Coming up in {dist}, CJ, you {action}.",
    ],
  },
  keep_now: {
    cj: [
      "Keep {dir}, homie.",
      "Now, {action}. Easy.",
      "Stay {dir} here, man.",
      "Hold {dir}, dawg.",
      "Okay, {action}, nice.",
    ],
    smoke: [
      "Keep {dir}, CJ. Steady.",
      "Now, {action}, CJ.",
      "Hold the {dir}, CJ. Beautiful.",
      "Yes sir, homie, {action}.",
      "Okay, {action}. Smoke is proud.",
    ],
  },
  roundabout_prepare: {
    cj: [
      "Roundabout in {dist}, homie, then {action}.",
      "In {dist}, {action}. Count the exits, homie.",
      "Heads up, roundabout in {dist}. You gonna {action}.",
      "In {dist}, {action}. Yield first, man.",
      "Okay dawg, in {dist}, {action}.",
    ],
    smoke: [
      "CJ, in {dist}, {action}. Roundabouts are like donuts.",
      "A roundabout in {dist}, CJ, so {action}.",
      "Listen, CJ. In {dist}, {action}. Count with me.",
      "In {dist}, {action}. Yield, homie, we got manners.",
      "Get ready, CJ. In {dist}, {action}.",
    ],
  },
  roundabout_now: {
    cj: [
      "Okay homie, {action}.",
      "Here's the circle, {action}.",
      "Yield, then {action}.",
      "Aight dawg, {action}.",
      "Around we go, {action}.",
    ],
    smoke: [
      "Round we go, CJ, {action}.",
      "Now, homie, {action}. Donut style.",
      "Here it is, homie, {action}.",
      "Yield, CJ, then {action}.",
      "Smooth, homie, {action}.",
    ],
  },
  endofroad_prepare: {
    cj: [
      "Road ends in {dist}, homie. Then {action}.",
      "In {dist}, road runs out, so {action}.",
      "In {dist}, {action}. Ain't no other choice.",
      "In about {dist}, {action}. Road's done after that.",
    ],
    smoke: [
      "In {dist}, homie, {action}. Can't go straight forever.",
      "CJ, in {dist}, the road ends. Then you {action}.",
    ],
  },
  endofroad_now: {
    cj: [
      "Road's over. Go {dir}, homie.",
      "End of the road, {action}.",
      "Now, dawg, go {dir}.",
      "Okay, {action}, man.",
      "That's the end. Turn {dir}.",
    ],
    smoke: [
      "Now, homie, {action}. Destiny turns.",
      "Here, CJ, {action}. No more straight.",
    ],
  },
  straight_prepare: {
    cj: [
      "In {dist}, {action}. No turns, homie.",
      "Intersection in {dist}. Just {action}.",
      "Heads up, in {dist}, {action}. Easy one.",
      "Okay dawg, {dist} ahead, {action}.",
      "In {dist}, {action}. Keep it steady, man.",
    ],
    smoke: [
      "In {dist}, {action}, CJ. Straight like my intentions.",
      "Listen, homie, in {dist}, {action}. No detours.",
      "Okay CJ, intersection in {dist}. You {action}.",
      "Mark my words, homie. In {dist}, {action}.",
      "In {dist}, {action}. Simple as a cheeseburger, CJ.",
    ],
  },
  straight_now: {
    cj: [
      "Straight through, homie, {action}.",
      "Just {action}, dawg.",
      "Nose forward, man, {action}.",
      "Okay, {action}. Easy.",
      "No turn here, {action}.",
    ],
    smoke: [
      "Straight ahead, CJ, {action}.",
      "No turns, homie. Just {action}.",
      "Now, CJ, {action}. Honest road.",
      "Steady, homie, {action}.",
      "Hold steady, CJ, {action}.",
    ],
  },
  arrive_prepare: {
    cj: [
      "Almost there, homie. In {dist}, {action}.",
      "In {dist}, {action}. We made it, man.",
      "Home stretch, dawg. In {dist}, {action}.",
      "Okay, in {dist}, {action}. Start thinking about parking.",
      "In about {dist}, {action}. Not bad, homie.",
    ],
    smoke: [
      "CJ, the end is near. In {dist}, {action}.",
      "In {dist}, {action}. Smoke delivers, homie.",
      "Okay homie, final stretch. In {dist}, {action}.",
      "In {dist}, {action}. Victory smells like fries, homie.",
    ],
  },
  arrive_now: {
    cj: [
      "This is it, homie, {action}.",
      "We here, man, {action}.",
      "That's the place, {action}.",
      "And we made it, {action}.",
      "Ease up, homie, {action}.",
    ],
    smoke: [
      "Behold, CJ, {action}.",
      "Easy now, CJ, {action}.",
      "The destination, homie, {action}. Beautiful.",
      "No further, CJ, {action}.",
    ],
  },
  generic_far: {
    cj: [
      "Way up ahead, in {dist}, {action}.",
      "No rush, but in {dist}, {action}.",
      "Just a heads up, homie. In {dist}, {action}.",
      "In {dist}, {action}. Keep that in mind, man.",
      "Long way off, dawg, but in {dist}, {action}.",
    ],
    smoke: [
      "CJ, see into the future. In {dist}, {action}.",
      "Far off, homie, about {dist}, {action}.",
      "In {dist}, CJ, {action}. Until then, relax.",
      "Smoke sees all, homie. In {dist}, {action}.",
      "No stress, homie. In {dist}, {action}.",
    ],
  },
  generic_prepare: {
    cj: [
      "In {dist}, {action}, dawg.",
      "Heads up, homie. In {dist}, {action}.",
      "Coming up in {dist}, {action}.",
      "Okay man, in {dist}, {action}.",
      "Get ready, dawg. In {dist}, {action}.",
    ],
    smoke: [
      "Listen to me, CJ. In {dist}, {action}.",
      "In {dist}, homie, {action}. Trust the Smoke.",
      "Okay CJ, in {dist}, {action}.",
      "Coming up, homie, in {dist}, {action}.",
      "In {dist}, {action}. Smoke never steers you wrong.",
    ],
  },
  generic_now: {
    cj: [
      "Here, {action}.",
      "Okay man, {action}.",
      "This is it, {action}.",
      "Aight homie, {action} here.",
      "Go on, homie, {action}.",
    ],
    smoke: [
      "CJ, it's time, {action}.",
      "Here, homie, {action}.",
      "Okay homie, {action}. Smooth.",
      "Listen to the Smoke, {action}.",
      "Go on, CJ, {action}.",
    ],
  },
  wrong_turn: {
    cj: [],
    smoke: [
      "All you had to do was follow the damn train, CJ!",
    ],
  },
  reroute: {
    cj: [
      "Okay, we off the line. Recalculating.",
      "Wrong way, homie. Give me a second.",
      "Damn, we went off. Gimme a sec.",
    ],
    smoke: [
      "Off the route, homie. Recalculating, like life.",
      "Hold up, CJ. Even geniuses get lost sometimes.",
      "That was not the way, homie. Let me think.",
    ],
  },
  arrived: {
    cj: [
      "That's {dest}, man. Good driving.",
      "Mission passed. Respect plus, homie.",
      "We made it to {dest}. Easy.",
    ],
    smoke: [
      "{dest}, homie. Another victory for the Smoke.",
      "We have arrived at {dest}, CJ. Big Smoke delivers.",
      "There it is, CJ. Smoke's navigation, five stars.",
    ],
  },
  cancel: {
    cj: [
      "Mission failed. Shake it off, homie.",
      "Calling it off? Aight, your call.",
      "Okay, we done. No shame, man.",
    ],
    smoke: [
      "Navigation over, homie. Smoke will remember this.",
      "We're quitting, CJ? I'm not mad. I'm disappointed.",
      "Cancelled? Damn, CJ, and I was just getting comfortable.",
    ],
  },
  gps_lost: {
    cj: [
      "No signal. Damn, these buildings.",
      "Satellites ditched us, homie. Hang tight.",
      "Signal's gone, homie. Like my brother's patience.",
    ],
    smoke: [
      "No signal, homie. Smoke is navigating by instinct now.",
      "Satellites are taking a break, homie. I respect that.",
      "The map is lost, CJ. But Smoke is never lost.",
    ],
  },
  route_failed: {
    cj: [
      "Map says no. Pick another spot, dawg.",
      "Nothing. Maybe it's across the water or something.",
      "Couldn't find a road. Check the address, homie.",
    ],
    smoke: [
      "No route, homie. Even Smoke has limits. Barely.",
      "The map has failed us, CJ. Try another destination.",
      "No path found, homie. That's crap, but we move on.",
    ],
  },
};
