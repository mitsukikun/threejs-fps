// The economy: money earned each round and spent in the buy menu between rounds. One
// table owns every price and every reward, so the HUD and the match logic can never
// disagree about what a kill or a rifle is worth.
import { WEAPONS } from './weapons.js';

export const REWARDS = {
  kill: 300,
  plant: 300,
  roundWin: 3250,
  roundLoss: 1900,
  detonation: 300,
};

export const GRENADE_PRICE = 300;
export const ARMOR_PRICE = 650;
export const ARMOR_VALUE = 100;
export const START_MONEY = 800;

export const BUY_ITEMS = [
  { key: '1', id: 'rifle', name: 'VK-47', price: WEAPONS.rifle.price, note: 'Rifle · 30 rounds · high damage' },
  { key: '2', id: 'smg', name: 'RAPTOR-9', price: WEAPONS.smg.price, note: 'SMG · 32 rounds · fast, close range' },
  { key: '3', id: 'sniper', name: 'LONGSHOT', price: WEAPONS.sniper.price, note: 'Marksman · 5 rounds · one-shot head' },
  { key: '4', id: 'grenade', name: 'F-1 FRAG', price: GRENADE_PRICE, note: 'Frag grenade · throw with G' },
  { key: '5', id: 'armor', name: 'KEVLAR VEST', price: ARMOR_PRICE, note: 'Armour · absorbs half of every hit' },
];

export function createEconomy(weapons) {
  const state = { money: START_MONEY };

  return {
    state,
    reset() {
      state.money = START_MONEY;
    },
    earn(amount) {
      state.money += amount;
    },
    // Returns 'bought', 'owned' or 'poor'. The HUD reads the result for its feedback.
    buy(itemId, playerState) {
      if (itemId === 'grenade') {
        if (weapons.state.grenades >= 1) return 'owned';
        if (state.money < GRENADE_PRICE) return 'poor';
        state.money -= GRENADE_PRICE;
        weapons.state.grenades += 1;
        return 'bought';
      }
      if (itemId === 'armor') {
        if (playerState.armor >= ARMOR_VALUE) return 'owned';
        if (state.money < ARMOR_PRICE) return 'poor';
        state.money -= ARMOR_PRICE;
        playerState.armor = ARMOR_VALUE;
        return 'bought';
      }
      const def = WEAPONS[itemId];
      if (!def) return 'poor';
      if (weapons.has(itemId)) return 'owned';
      if (state.money < def.price) return 'poor';
      state.money -= def.price;
      weapons.buy(itemId);
      weapons.switchTo(itemId);
      return 'bought';
    },
  };
}
