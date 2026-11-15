// The look plan, in one place. DUSTLINE is a dusk industrial yard: warm sand under a low
// amber sun, rust-orange steel against deep blue-grey shadow. Six values only; the lighting
// makes every shade the game needs, so no other colour appears in the code. The same six
// names are the CSS custom properties in index.html.
export const PALETTE = {
  canvas: '#191009', // dusk sky / fog
  surface: '#2b2118', // dark steel and shadowed walls
  hairline: '#4a3826', // crates, trim, mid-tone cover
  ink: '#f2e8d5', // sand-light, text, tracer cores
  muted: '#a89880', // dusty mid tones, HUD secondary text
  accent: '#ff7a1a', // safety orange: sites, markers, muzzle light
};

export function shade(name) {
  return PALETTE[name];
}
