// OSRM step -> neutral instruction phrase, icon key and line-bank "kind".

const ORDINALS = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth'];
const CARDINALS = ['north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest'];

const sideOf = (modifier, fallback = 'right') =>
  modifier?.includes('left') ? 'left' : modifier?.includes('right') ? 'right' : fallback;

function streetOf(step) {
  const name = (step.name || '').trim();
  const ref = (step.ref || '').split(';')[0].trim();
  return name || ref || '';
}

function towardsOf(step) {
  if (!step.destinations) return '';
  const raw = step.destinations.includes(':') ? step.destinations.split(':').slice(1).join(':') : step.destinations;
  return raw.split(',').map((s) => s.trim()).filter(Boolean).slice(0, 2).join(' and ');
}

/**
 * @returns {{kind:string, icon:string, action:string, dir:string, street:string, exit:string,
 *            speakable:boolean, instruction:string}}
 */
export function describeStep(step) {
  const m = step.maneuver || {};
  const type = m.type || 'turn';
  const mod = m.modifier || '';
  const drivingSide = step.driving_side || 'right';
  const street = streetOf(step);
  const towards = towardsOf(step);
  const onto = street ? ` onto ${street}` : '';
  const side = sideOf(mod, drivingSide);

  let kind = 'generic', icon = 'straight', action = '', dir = '', exit = '', speakable = true;

  const turnish = (prefix = '') => {
    if (mod === 'uturn') {
      kind = 'uturn'; icon = drivingSide === 'left' ? 'uturn-right' : 'uturn-left';
      action = `${prefix}make a U-turn${onto}`; dir = 'around';
    } else if (mod.startsWith('sharp')) {
      kind = 'sharp'; icon = `sharp-${side}`; dir = `sharp ${side}`;
      action = `${prefix}take a sharp ${side}${onto}`;
    } else if (mod.startsWith('slight')) {
      kind = 'slight'; icon = `slight-${side}`; dir = `slight ${side}`;
      action = `${prefix}bear ${side}${onto}`;
    } else if (mod === 'left' || mod === 'right') {
      kind = 'turn'; icon = `turn-${side}`; dir = side;
      action = `${prefix}turn ${side}${onto}`;
    } else {
      kind = 'straight'; icon = 'straight'; dir = 'straight';
      action = `${prefix}continue straight${onto}`;
    }
  };

  switch (type) {
    case 'depart': {
      kind = 'depart'; icon = 'depart';
      const card = CARDINALS[Math.round(((m.bearing_after ?? 0) % 360) / 45) % 8];
      action = `head ${card}${street ? ` on ${street}` : ''}`;
      break;
    }
    case 'arrive':
      kind = 'arrive'; icon = 'arrive';
      action = mod === 'left' || mod === 'right' || mod.startsWith('slight') || mod.startsWith('sharp')
        ? `your destination is on the ${side}` : 'you have reached your destination';
      dir = side;
      break;
    case 'merge':
      kind = 'merge'; icon = `merge-${sideOf(mod, drivingSide === 'right' ? 'left' : 'right')}`;
      dir = mod && mod !== 'straight' ? side : '';
      action = `merge${dir ? ` ${dir}` : ''}${onto}`;
      break;
    case 'on ramp':
      kind = 'ramp'; icon = `ramp-${side}`; dir = side;
      action = `take the ramp${mod && mod !== 'straight' ? ` on the ${side}` : ''}${towards ? ` towards ${towards}` : onto}`;
      break;
    case 'off ramp': {
      kind = 'exit'; icon = `ramp-${side}`; dir = side;
      const num = (step.exits || '').split(';')[0];
      action = `take ${num ? `exit ${num}` : 'the exit'}${mod && mod !== 'straight' ? ` on the ${side}` : ''}${towards ? ` towards ${towards}` : onto}`;
      break;
    }
    case 'fork':
      kind = 'fork'; icon = `fork-${side}`; dir = side;
      action = `keep ${side} at the fork${towards ? ` towards ${towards}` : onto}`;
      break;
    case 'end of road':
      turnish('at the end of the road, ');
      if (kind === 'turn' || kind === 'sharp' || kind === 'slight') kind = 'endofroad';
      break;
    case 'roundabout':
    case 'rotary': {
      kind = 'roundabout'; icon = drivingSide === 'left' ? 'roundabout-cw' : 'roundabout-ccw';
      const where = type === 'rotary' && step.rotary_name ? `at ${step.rotary_name}` : 'at the roundabout';
      if (m.exit) {
        exit = ORDINALS[m.exit - 1] || `number ${m.exit}`;
        action = `${where}, take the ${exit} exit${onto}`;
      } else {
        action = `enter the roundabout${onto}`;
      }
      break;
    }
    case 'roundabout turn':
      turnish('at the roundabout, ');
      break;
    case 'exit roundabout':
    case 'exit rotary':
    case 'notification':
      speakable = false; icon = 'straight'; action = `continue${onto}`;
      break;
    case 'continue':
      if (mod.startsWith('slight')) {
        kind = 'keep'; icon = `keep-${side}`; dir = side; action = `keep ${side}${onto}`;
      } else if (!mod || mod === 'straight') {
        speakable = false; kind = 'straight'; icon = 'straight'; action = `continue${onto}`;
      } else {
        turnish();
      }
      break;
    case 'new name':
      if (!mod || mod === 'straight' || mod.startsWith('slight')) {
        speakable = false; kind = 'straight'; icon = 'straight'; action = `continue${onto}`;
      } else {
        turnish();
      }
      break;
    default: // 'turn', 'use lane', unknown
      if (type === 'use lane' && (!mod || mod === 'straight')) {
        speakable = false; action = `continue${onto}`;
      } else {
        turnish();
      }
  }

  return {
    kind, icon, action, dir, street, exit, speakable, type, modifier: mod || null,
    exitNumber: m.exit ?? null, drivingSide,
    instruction: action ? action[0].toUpperCase() + action.slice(1) : '',
  };
}
