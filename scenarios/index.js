import twjp from './tw-jp.js';
import tpkh from './tp-kh.js';
import asiaConquest from './asia-conquest.js';

export const SCENARIOS = {
  [twjp.id]: twjp,
  [tpkh.id]: tpkh,
  [asiaConquest.id]: asiaConquest,
};

export const DEFAULT_SCENARIO = twjp.id;

export function listScenarios() {
  return Object.values(SCENARIOS).map(s => ({ id: s.id, name: s.name, mode: s.mode, hasNavy: s.hasNavy, desc: s.desc || '' }));
}
