// The DOM HUD: crosshair, hit marker, health and armour, ammo, money, the round timer
// and score, kill feed, banners, the plant/defuse bar and the buy menu. It never touches
// the simulation; main.js pushes numbers in and reads the play callback out. Every
// setter is cached, so the DOM is only written when a value actually changes.
import { BUY_ITEMS } from './economy.js';

const OVERLAY_COPY = {
  start: {
    title: 'DUSTLINE',
    copy: 'Site 7, dusk. You carry the spike: plant it at A or B, or drop all four Sentinels. First to 5 rounds takes the match.',
    action: 'Click to play',
  },
  paused: {
    title: 'DUSTLINE',
    copy: 'Paused. Click to resume.',
    action: 'Click to resume',
  },
  dead: {
    title: 'You are down',
    copy: 'The Sentinels take the round.',
    action: 'Next round',
  },
  roundEnd: {
    title: 'Round over',
    copy: '',
    action: 'Next round',
  },
  matchEnd: {
    title: 'Match over',
    copy: '',
    action: 'Play again',
  },
};

export function createHud() {
  const $ = (id) => document.getElementById(id);
  const overlay = $('overlay');
  const title = $('overlay-title');
  const copy = $('overlay-copy');
  const play = $('play');
  const crosshair = $('crosshair');
  const hitmarker = $('hitmarker');
  const healthNum = $('health-num');
  const healthBar = $('health-bar');
  const armorBar = $('armor-bar');
  const ammoMag = $('ammo-mag');
  const ammoReserve = $('ammo-reserve');
  const weaponName = $('weapon-name');
  const moneyEl = $('money');
  const timerEl = $('timer');
  const scoreAtk = $('score-atk');
  const scoreDef = $('score-def');
  const roundLabel = $('round-label');
  const killfeed = $('killfeed');
  const banner = $('banner');
  const bannerTitle = $('banner-title');
  const bannerSub = $('banner-sub');
  const vignette = $('vignette');
  const plantBar = $('plant-bar');
  const plantFill = $('plant-fill');
  const plantLabel = $('plant-label');
  const bombStatus = $('bomb-status');
  const buyPanel = $('buy');
  const buyItems = $('buy-items');
  const buyMoney = $('buy-money');

  let lastHealth = -1;
  let lastArmor = -1;
  let lastMag = -1;
  let lastReserve = -1;
  let lastWeapon = '';
  let lastMoney = -1;
  let lastTimer = -1;
  let lastScore = '';
  let lastBomb = '';
  let hitTimer = 0;
  let bannerTimer = 0;
  let vignetteUntil = 0;

  // Buy menu rows, built once from the economy's table.
  for (const item of BUY_ITEMS) {
    const row = document.createElement('div');
    row.className = 'buy-row';
    row.dataset.item = item.id;
    row.innerHTML = `<span class="buy-key">${item.key}</span><span class="buy-name">${item.name}</span><span class="buy-note">${item.note}</span><span class="buy-price">$${item.price}</span>`;
    buyItems.appendChild(row);
  }

  function markBought(itemId, result) {
    for (const row of buyItems.children) {
      if (row.dataset.item !== itemId) continue;
      row.classList.remove('bought', 'poor');
      if (result === 'bought' || result === 'owned') row.classList.add('bought');
      if (result === 'poor') row.classList.add('poor');
    }
  }

  return {
    setHealth(health, armor) {
      if (health === lastHealth && armor === lastArmor) return;
      lastHealth = health;
      lastArmor = armor;
      healthNum.textContent = String(Math.ceil(health));
      healthBar.style.width = `${health}%`;
      healthBar.classList.toggle('low', health <= 30);
      armorBar.style.width = `${armor}%`;
    },
    setAmmo(mag, reserve, weapon) {
      if (mag === lastMag && reserve === lastReserve && weapon === lastWeapon) return;
      lastMag = mag;
      lastReserve = reserve;
      lastWeapon = weapon;
      ammoMag.textContent = String(mag);
      ammoReserve.textContent = `/ ${reserve}`;
      weaponName.textContent = weapon;
      $('ammo').classList.toggle('empty', mag === 0);
    },
    setMoney(value) {
      if (value === lastMoney) return;
      lastMoney = value;
      moneyEl.textContent = `$${value}`;
      buyMoney.textContent = `$${value}`;
    },
    setTimer(seconds, round, atk, def) {
      const shown = Math.max(0, Math.ceil(seconds));
      const score = `${atk}-${def}`;
      if (shown === lastTimer && score === lastScore) return;
      lastTimer = shown;
      lastScore = score;
      timerEl.textContent = `${Math.floor(shown / 60)}:${String(shown % 60).padStart(2, '0')}`;
      timerEl.classList.toggle('urgent', shown <= 10);
      scoreAtk.textContent = String(atk);
      scoreDef.textContent = String(def);
      roundLabel.textContent = `ROUND ${round}`;
    },
    setCrosshairGap(pixels) {
      crosshair.style.setProperty('--gap', `${pixels.toFixed(1)}px`);
    },
    hitMarker(killed, holdMs = 90) {
      hitmarker.classList.add('on');
      hitmarker.classList.toggle('kill', killed);
      clearTimeout(hitTimer);
      hitTimer = setTimeout(() => hitmarker.classList.remove('on', 'kill'), holdMs);
    },
    killfeed(text) {
      const line = document.createElement('div');
      line.className = 'feed-line';
      line.textContent = text;
      killfeed.prepend(line);
      while (killfeed.children.length > 5) killfeed.lastChild.remove();
      setTimeout(() => line.classList.add('fade'), 4200);
      setTimeout(() => line.remove(), 5000);
    },
    showBanner(main, sub = '', holdMs = 2200) {
      bannerTitle.textContent = main;
      bannerSub.textContent = sub;
      banner.classList.add('on');
      clearTimeout(bannerTimer);
      bannerTimer = setTimeout(() => banner.classList.remove('on'), holdMs);
    },
    // Captures hide the transient banner so the frame shows the game, not the
    // round-start announcement that was still fading.
    hideBanner() {
      clearTimeout(bannerTimer);
      banner.classList.remove('on');
    },
    damageFlash() {
      vignetteUntil = performance.now() + 260;
      vignette.classList.add('on');
      setTimeout(() => {
        if (performance.now() >= vignetteUntil) vignette.classList.remove('on');
      }, 280);
    },
    setPlant(progress, label) {
      if (progress === null) {
        plantBar.hidden = true;
        return;
      }
      plantBar.hidden = false;
      plantFill.style.width = `${Math.round(progress * 100)}%`;
      plantLabel.textContent = label;
    },
    setBomb(text) {
      if (text === lastBomb) return;
      lastBomb = text;
      bombStatus.textContent = text;
      bombStatus.hidden = text === '';
    },
    showOverlay(mode, detail = '') {
      const text = OVERLAY_COPY[mode];
      title.textContent = text.title;
      copy.textContent = mode === 'roundEnd' || mode === 'matchEnd' ? detail : text.copy;
      play.textContent = text.action;
      overlay.hidden = false;
      play.focus();
    },
    hideOverlay() {
      overlay.hidden = true;
    },
    showBuy(open) {
      buyPanel.hidden = !open;
    },
    markBuy(itemId, result) {
      markBought(itemId, result);
    },
    onPlay(handler) {
      play.addEventListener('click', handler);
    },
  };
}
