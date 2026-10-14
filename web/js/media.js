// Music controls for whatever is playing on the phone (Spotify, YouTube Music, ...).
// Android app only: the native side reads the active media session (needs notification
// access, granted once) and pushes SA.onMedia(state). In a plain browser this stays hidden.

const $ = (id) => document.getElementById(id);
const native = () => typeof window.SANative !== 'undefined' && typeof window.SANative.mediaState === 'function';

export class Media {
  constructor({ getSettings, isCar }) {
    this.getSettings = getSettings;
    this.isCar = isCar;
    this.state = null;
    this.access = 'denied';
    this.el = {
      box: $('radio'), art: $('radio-art'), title: $('radio-title'), artist: $('radio-artist'),
      toggle: $('radio-toggle'), connect: $('radio-connect'), banner: $('radio-banner'),
    };
    $('radio-prev').addEventListener('click', () => this.command('prev'));
    $('radio-next').addEventListener('click', () => this.command('next'));
    this.el.toggle.addEventListener('click', () => this.command('toggle'));
    this.el.connect.addEventListener('click', () => {
      try { window.SANative.openMediaAccess(); } catch { /* old app */ }
    });
    // Coming back from the settings screen: re-check access.
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') this.refresh(); });
  }

  get enabled() { return native() && this.getSettings().music !== false; }

  refresh() {
    if (!native()) { this.render(); return; }
    try {
      this.access = window.SANative.mediaAccess();
      this.update(JSON.parse(window.SANative.mediaState() || 'null'), { quiet: true });
    } catch {
      this.render();
    }
  }

  /** SA.onMedia */
  update(state, { quiet = false } = {}) {
    const prev = this.state;
    this.state = state && state.title ? state : null;
    if (this.state) this.access = 'granted';
    if (!quiet && this.state && this.state.title !== prev?.title) this.showBanner(this.state);
    this.render();
  }

  command(cmd) {
    if (!native()) return;
    try { window.SANative.mediaCommand(cmd); } catch { /* ignore */ }
    if (cmd === 'toggle' && this.state) { this.state.playing = !this.state.playing; this.render(); }
  }

  render() {
    const on = this.enabled;
    const s = this.state;
    const showBox = on && !!s;
    const showConnect = on && !s && this.access !== 'granted' && !this.isCar;
    this.el.box.hidden = !showBox;
    this.el.connect.hidden = !showConnect;
    document.body.classList.toggle('has-radio', showBox || showConnect);
    if (!showBox) return;
    this.el.title.textContent = s.title;
    this.el.artist.textContent = [s.artist, s.app].filter(Boolean).join(' · ');
    this.el.art.hidden = !s.art;
    if (s.art && this.el.art.src !== s.art) this.el.art.src = s.art;
    // blurred copy of the cover tints the glass (data: URLs only, from the app)
    this.el.box.style.setProperty('--art', s.art?.startsWith('data:image/') ? `url("${s.art}")` : 'none');
    this.el.toggle.classList.toggle('playing', !!s.playing);
    this.el.toggle.setAttribute('aria-label', s.playing ? 'Pause' : 'Play');
  }

  // SA shows the station name big at the top when you change the radio.
  showBanner(s) {
    const b = this.el.banner;
    clearTimeout(this.bannerTimer);
    b.textContent = s.title;
    b.classList.remove('show');
    void b.offsetWidth;
    b.classList.add('show');
    this.bannerTimer = setTimeout(() => b.classList.remove('show'), 3200);
  }
}
