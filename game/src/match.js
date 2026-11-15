// The match: first to 5 rounds, at most 9. One round is a buy phase, a live phase, and
// — if the spike goes down — a post-plant fuse. The attacker wins a round by dropping
// all four Sentinels or by detonating the spike; the defenders win by dropping the
// attacker, running the clock out, or defusing. Money, weapons and armour carry between
// rounds; health and grenades do not. The module owns the phase clock and every
// transition, so main.js only feeds it input and time.
import { REWARDS } from './economy.js';
import { SITES } from './world.js';

const ROUNDS_TO_WIN = 5;
const MAX_ROUNDS = 9;
const BUY_SECONDS = 15;
const ROUND_SECONDS = 100;
const FUSE_SECONDS = 35;
const PLANT_SECONDS = 3;
const END_SECONDS = 4.5;

export function createMatch(deps) {
  const { player, bots, weapons, economy, hud, audio, effects, world } = deps;

  const state = {
    round: 1,
    atkWins: 0,
    defWins: 0,
    phase: 'buy',
    phaseLeft: BUY_SECONDS,
    plant: { active: false, site: null, fuseLeft: 0, defused: false },
    plantProgress: 0,
    planting: false,
    over: false,
    winner: null,
  };
  let endTimer = 0;
  let pendingWinner = null;
  let pendingReason = '';

  function currentSite() {
    for (const site of Object.values(SITES)) {
      const dx = player.state.position.x - site.center.x;
      const dz = player.state.position.z - site.center.z;
      if (Math.hypot(dx, dz) <= site.radius) return site;
    }
    return null;
  }

  function startRound() {
    player.reset(world.spawns.attacker);
    bots.reset(world.spawns.defenders);
    weapons.refillAmmo();
    state.plant.active = false;
    state.plant.site = null;
    state.plant.fuseLeft = 0;
    state.plant.defused = false;
    state.plantProgress = 0;
    state.planting = false;
    state.phase = 'buy';
    state.phaseLeft = BUY_SECONDS;
    pendingWinner = null;
    hud.setBomb('SPIKE CARRIED');
    hud.setPlant(null);
    hud.showBanner(`ROUND ${state.round}`, 'Buy phase — press B for the shop', 2400);
    hud.showBuy(true);
    hud.setHealth(player.state.health, player.state.armor);
    hud.setAmmo(weapons.ammo().mag, weapons.ammo().reserve, weapons.def().name);
    hud.setMoney(economy.state.money);
    hud.setTimer(state.phaseLeft, state.round, state.atkWins, state.defWins);
  }

  function resolveRound(winner, reason) {
    if (state.phase === 'end' || state.over) return;
    pendingWinner = winner;
    pendingReason = reason;
    endTimer = winner === 'atk' && reason === 'detonation' ? 1.2 : 2.2;
    state.phase = 'ending';
    if (winner === 'atk') {
      economy.earn(REWARDS.roundWin + (reason === 'detonation' ? REWARDS.detonation : 0));
      audio.roundWin();
    } else {
      economy.earn(REWARDS.roundLoss);
      audio.roundLose();
    }
  }

  function finishRound() {
    const winner = pendingWinner;
    if (winner === 'atk') state.atkWins += 1;
    else state.defWins += 1;
    hud.setMoney(economy.state.money);
    hud.setTimer(0, state.round, state.atkWins, state.defWins);
    if (state.atkWins >= ROUNDS_TO_WIN || state.defWins >= ROUNDS_TO_WIN || state.round >= MAX_ROUNDS) {
      state.over = true;
      state.winner = state.atkWins > state.defWins ? 'atk' : 'def';
      state.phase = 'matchEnd';
      const detail =
        state.winner === 'atk'
          ? `Vanguard takes the match ${state.atkWins}–${state.defWins}. The yard is yours.`
          : `Sentinels take the match ${state.defWins}–${state.atkWins}. The spike never went off.`;
      hud.showOverlay('matchEnd', detail);
      hud.showBuy(false);
      if (document.pointerLockElement) document.exitPointerLock();
      return;
    }
    state.round += 1;
    state.phase = 'end';
    endTimer = END_SECONDS;
    hud.showOverlay('roundEnd', `${pendingReason} — Vanguard ${state.atkWins} · Sentinels ${state.defWins}`);
    hud.showBuy(false);
    if (document.pointerLockElement) document.exitPointerLock();
  }

  function detonate() {
    const site = state.plant.site;
    effects.spawnExplosion(site.center);
    audio.explosion();
    hud.showBanner('SPIKE DETONATED', `Site ${site.name} is gone`, 2600);
    hud.setBomb('');
    resolveRound('atk', 'detonation');
  }

  return {
    state,
    startRound,
    resetMatch() {
      state.round = 1;
      state.atkWins = 0;
      state.defWins = 0;
      state.over = false;
      state.winner = null;
      economy.reset();
      weapons.refillAmmo();
      startRound();
    },
    // Called when the player lands a killing blow; the economy and the feed live here.
    onKill(bot) {
      economy.earn(REWARDS.kill);
      hud.setMoney(economy.state.money);
      hud.killfeed(`You ▸ SENTINEL-${bot.index + 1}  +$${REWARDS.kill}`);
    },
    onPlant() {
      economy.earn(REWARDS.plant);
      hud.setMoney(economy.state.money);
      hud.killfeed(`Spike planted  +$${REWARDS.plant}`);
    },
    step(dt, input, now) {
      if (state.over) return;

      if (state.phase === 'end') {
        endTimer -= dt;
        if (endTimer <= 0) startRound();
        return;
      }
      if (state.phase === 'ending') {
        endTimer -= dt;
        if (endTimer <= 0) finishRound();
        return;
      }

      if (state.phase === 'buy') {
        state.phaseLeft -= dt;
        hud.setTimer(state.phaseLeft, state.round, state.atkWins, state.defWins);
        if (state.phaseLeft <= 0) {
          state.phase = 'live';
          state.phaseLeft = ROUND_SECONDS;
          hud.showBuy(false);
          hud.showBanner(`ROUND ${state.round}`, 'Plant the spike at A or B', 2200);
        }
        return;
      }

      if (state.phase === 'live' || state.phase === 'postplant') {
        state.phaseLeft -= dt;
        hud.setTimer(state.phaseLeft, state.round, state.atkWins, state.defWins);
      }

      // Plant channel: hold E inside a site, standing still enough. Moving cancels it.
      const site = !state.plant.active && player.state.alive ? currentSite() : null;
      const holding = input.state.keys.has('KeyE');
      const moving = input.state.keys.has('KeyW') || input.state.keys.has('KeyA') || input.state.keys.has('KeyS') || input.state.keys.has('KeyD');
      if (site && holding && !moving && player.state.onGround) {
        state.planting = true;
        state.plantProgress += dt / PLANT_SECONDS;
        hud.setPlant(state.plantProgress, `PLANTING SPIKE — SITE ${site.name}`);
        if (Math.floor(state.plantProgress * 6) !== Math.floor((state.plantProgress - dt / PLANT_SECONDS) * 6)) audio.plantBeep(false);
        if (state.plantProgress >= 1) {
          state.plant.active = true;
          state.plant.site = site;
          state.plant.fuseLeft = FUSE_SECONDS;
          state.plant.defused = false;
          state.planting = false;
          state.plantProgress = 0;
          state.phase = 'postplant';
          state.phaseLeft = FUSE_SECONDS;
          hud.setPlant(null);
          hud.setBomb(`SPIKE PLANTED — SITE ${site.name}`);
          hud.showBanner('SPIKE PLANTED', `Site ${site.name} · ${FUSE_SECONDS}s to detonation`, 2600);
          audio.plantBeep(true);
          this.onPlant();
        }
      } else {
        state.planting = false;
        state.plantProgress = Math.max(0, state.plantProgress - dt * 2);
        hud.setPlant(state.plantProgress > 0 ? state.plantProgress : null, 'PLANTING SPIKE');
      }

      if (state.plant.active) {
        state.plant.fuseLeft -= dt;
        state.phaseLeft = state.plant.fuseLeft;
        hud.setBomb(`SPIKE PLANTED — ${Math.ceil(state.plant.fuseLeft)}s`);
        if (state.plant.defused) {
          hud.setBomb('');
          resolveRound('def', 'Spike defused');
          return;
        }
        if (state.plant.fuseLeft <= 0) {
          detonate();
          return;
        }
      }

      if (!player.state.alive) {
        hud.showOverlay('dead');
        resolveRound('def', 'You were dropped');
        return;
      }
      if (bots.aliveCount() === 0) {
        resolveRound('atk', state.plant.active ? 'Site cleared' : 'All Sentinels down');
        return;
      }
      if (state.phase === 'live' && state.phaseLeft <= 0) {
        resolveRound('def', 'Time expired — spike never planted');
      }
    },
  };
}
