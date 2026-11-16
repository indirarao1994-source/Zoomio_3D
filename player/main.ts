import './player.css';
import { PanoEngine } from '../src/viewer/PanoEngine';
import type { PanoHotspot, PanoScene } from '../src/viewer/types';

/**
 * The standalone tour player. This is what ships inside the downloaded ZIP and
 * what runs on a hosted subdomain — identical code in both cases, driven
 * entirely by the sibling `tour.json`.
 */

interface FloorPlan {
  id: string;
  name: string;
  imageUrl: string;
  markers: { sceneId: string; x: number; y: number }[];
}

interface LeadConfig {
  enabled: boolean;
  endpoint: string;
  headline: string;
  buttonText: string;
}

interface TourData {
  name: string;
  description?: string;
  logo?: string | null;
  theme?: { primaryColor?: string; textColor?: string; showWatermark?: boolean; watermarkText?: string };
  floorPlans?: FloorPlan[];
  leads?: LeadConfig | null;
  scenes: (PanoScene & { thumbnail?: string })[];
}

const ICONS = {
  play: '<svg viewBox="0 0 24 24"><polygon points="6 3 20 12 6 21 6 3"/></svg>',
  pause: '<svg viewBox="0 0 24 24"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>',
  expand: '<svg viewBox="0 0 24 24"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/></svg>',
  compress: '<svg viewBox="0 0 24 24"><path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3"/></svg>',
  gyro: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="9" ry="4"/><ellipse cx="12" cy="12" rx="4" ry="9"/></svg>',
  vr: '<svg viewBox="0 0 24 24"><path d="M3 8h18a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-5l-2-2h-4l-2 2H3a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z"/></svg>',
  ar: '<svg viewBox="0 0 24 24"><path d="M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3z"/><path d="M12 12l8-4.5M12 12v9M12 12L4 7.5"/></svg>',
  info: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 16v-5M12 8h.01"/></svg>',
  sound: '<svg viewBox="0 0 24 24"><path d="M11 5L6 9H2v6h4l5 4V5z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/></svg>',
  mute: '<svg viewBox="0 0 24 24"><path d="M11 5L6 9H2v6h4l5 4V5z"/><path d="M22 9l-6 6M16 9l6 6"/></svg>',
  mail: '<svg viewBox="0 0 24 24"><rect x="2.5" y="5" width="19" height="14" rx="2"/><path d="M3 6.5l9 6 9-6"/></svg>',
};

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  html?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (html !== undefined) node.innerHTML = html;
  return node;
}

function button(className: string, icon: string, label: string): HTMLButtonElement {
  const b = el('button', className, icon);
  b.type = 'button';
  b.title = label;
  b.setAttribute('aria-label', label);
  return b;
}

class TourPlayer {
  private root: HTMLElement;
  private stage = el('div', 'pt-stage');
  private engine!: PanoEngine;
  private data!: TourData;

  private loader = el('div', 'pt-loader');
  private progressBar = el('span');
  private enterBtn = el('button', 'pt-enter');
  private sceneLabel = el('div', 'pt-title-scene');
  private compassDial = el('div', 'pt-compass-dial');
  private rail = el('div', 'pt-tabs');
  private tooltip = el('div', 'pt-tooltip');
  private toast = el('div', 'pt-toast');
  private modal = el('div', 'pt-modal');
  private modalCard = el('div', 'pt-modal-card');

  private autoRotateBtn!: HTMLButtonElement;
  private narrationBtn!: HTMLButtonElement;
  private mapCone: HTMLElement | null = null;
  private mapPins = new Map<string, HTMLElement>();
  private audio: HTMLAudioElement | null = null;
  private speaking = false;

  constructor(root: HTMLElement) {
    this.root = root;
  }

  async start() {
    this.buildLoader();
    try {
      const response = await fetch('./tour.json', { cache: 'no-cache' });
      if (!response.ok) throw new Error(`tour.json returned ${response.status}`);
      this.data = (await response.json()) as TourData;
    } catch (err) {
      this.failLoad(err);
      return;
    }

    if (!this.data.scenes?.length) {
      this.failLoad(new Error('This tour has no scenes yet.'));
      return;
    }

    const accent = this.data.theme?.primaryColor || '#2563eb';
    document.documentElement.style.setProperty('--pt-accent', accent);
    document.title = `${this.data.name} — 360° Virtual Tour`;

    this.buildChrome();

    this.engine = new PanoEngine({
      container: this.stage,
      scenes: this.data.scenes,
      theme: { primaryColor: accent, textColor: this.data.theme?.textColor || '#ffffff' },
      autoRotateSpeed: 0,
      xr: true,
      onProgress: (p) => {
        this.progressBar.style.width = `${Math.round(p * 100)}%`;
      },
      onReady: () => {
        this.enterBtn.disabled = false;
        this.enterBtn.textContent = 'Enter the tour';
      },
      onSceneChange: (sceneId) => this.onSceneChange(sceneId),
      onCameraMove: (yaw) => {
        this.compassDial.style.transform = `rotate(${-yaw}deg)`;
        const current = this.data.scenes[this.engine?.getCurrentIndex() ?? 0];
        if (current) this.updateMinimap(current.id, yaw);
      },
      onHotspotClick: (hotspot) => this.onHotspotClick(hotspot),
      onHotspotHover: (hotspot) => this.onHotspotHover(hotspot),
      onError: (message) => this.showToast(message),
    });

    await this.setupXRButtons();
  }

  /* ──────────────────── public API for embedding pages ──────────────── */

  /** Jump to a scene by its id. Returns false if that scene doesn't exist. */
  goToScene(sceneId: string): boolean {
    if (!this.data?.scenes.some((s) => s.id === sceneId)) return false;
    void this.engine.goToScene(sceneId);
    return true;
  }

  nextScene() {
    this.engine.next();
  }

  previousScene() {
    this.engine.prev();
  }

  /** Escape hatch to the underlying renderer for advanced integrations. */
  getEngine(): PanoEngine {
    return this.engine;
  }

  /* ────────────────────────────── chrome ────────────────────────────── */

  private buildLoader() {
    const title = el('h1');
    title.textContent = 'Loading tour…';
    const note = el('p');
    note.textContent = 'Preparing the first panorama.';

    const progress = el('div', 'pt-progress');
    progress.appendChild(this.progressBar);

    this.enterBtn.textContent = 'Loading…';
    this.enterBtn.disabled = true;
    this.enterBtn.type = 'button';
    this.enterBtn.addEventListener('click', () => {
      this.loader.hidden = true;
      // Autoplay policies require a gesture; this click is it.
      this.playNarration();
    });

    this.loader.append(title, note, progress, this.enterBtn);
    this.loader.dataset.title = 'true';
    this.root.append(this.stage, this.loader);
  }

  private failLoad(err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    this.loader.innerHTML = '';
    const h = el('h1');
    h.textContent = 'This tour could not be loaded';
    const p = el('p');
    p.textContent =
      `${message}. If you opened index.html directly from your file system, ` +
      'serve the folder over http instead — for example: python -m http.server 8000';
    this.loader.append(h, p);
  }

  private buildChrome() {
    const header = el('div', 'pt-header');

    const titleBox = el('div', 'pt-title pt-panel');
    if (this.data.logo) {
      const logo = el('img');
      logo.src = this.data.logo;
      logo.alt = '';
      titleBox.appendChild(logo);
    }
    const titleText = el('div', 'pt-title-text');
    const project = el('div', 'pt-title-project');
    project.textContent = this.data.name;
    titleText.append(this.sceneLabel, project);
    titleBox.appendChild(titleText);

    const actions = el('div', 'pt-actions');

    this.autoRotateBtn = button('pt-btn', ICONS.play, 'Auto-rotate');
    this.autoRotateBtn.setAttribute('aria-pressed', 'false');
    this.autoRotateBtn.addEventListener('click', () => this.toggleAutoRotate());

    this.narrationBtn = button('pt-btn', ICONS.sound, 'Play narration');
    this.narrationBtn.addEventListener('click', () => this.toggleNarration());

    const infoBtn = button('pt-btn', ICONS.info, 'About this tour');
    infoBtn.addEventListener('click', () => this.showAbout());

    const fsBtn = button('pt-btn', ICONS.expand, 'Fullscreen');
    fsBtn.addEventListener('click', () => {
      if (document.fullscreenElement) void document.exitFullscreen();
      else void document.documentElement.requestFullscreen().catch(() => {});
    });
    document.addEventListener('fullscreenchange', () => {
      fsBtn.innerHTML = document.fullscreenElement ? ICONS.compress : ICONS.expand;
    });

    actions.append(this.autoRotateBtn, this.narrationBtn, infoBtn, fsBtn);

    // Only offer the gyroscope where a device actually reports orientation.
    if ('DeviceOrientationEvent' in window && matchMedia('(pointer: coarse)').matches) {
      const gyroBtn = button('pt-btn', ICONS.gyro, 'Move your phone to look around');
      gyroBtn.setAttribute('aria-pressed', 'false');
      gyroBtn.addEventListener('click', async () => {
        if (this.engine.isGyroEnabled()) {
          this.engine.disableGyro();
          gyroBtn.setAttribute('aria-pressed', 'false');
          return;
        }
        const ok = await this.engine.enableGyro();
        gyroBtn.setAttribute('aria-pressed', String(ok));
        this.showToast(
          ok ? 'Move your phone to look around' : 'Motion access was not granted',
        );
      });
      actions.appendChild(gyroBtn);
    }

    header.append(titleBox, actions);
    this.root.appendChild(header);

    // Compass
    const compass = el('div', 'pt-compass pt-panel');
    this.compassDial.append(el('div', 'pt-compass-needle'), el('div', 'pt-compass-n', 'N'));
    compass.appendChild(this.compassDial);
    this.root.appendChild(compass);

    if (this.data.scenes.length > 1) this.buildRail();
    this.buildMinimap();
    this.buildEnquiryButton();

    this.modal.hidden = true;
    this.modal.appendChild(this.modalCard);
    this.modal.addEventListener('click', (e) => {
      if (e.target === this.modal) this.closeModal();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.closeModal();
    });

    if (this.data.theme?.showWatermark !== false) {
      const badge = el('div', 'pt-badge');
      badge.textContent = this.data.theme?.watermarkText || '360° Virtual Tour';
      this.root.appendChild(badge);
    }

    this.root.append(this.tooltip, this.toast, this.modal);
  }

  /**
   * Room tabs along the bottom edge.
   *
   * Named tabs rather than thumbnails: on a property tour people navigate by
   * room name ("show me the master bedroom"), and two beige interiors are
   * indistinguishable as 90px thumbnails.
   */
  private buildRail() {
    this.data.scenes.forEach((scene, index) => {
      const tab = el('button', 'pt-tab');
      tab.type = 'button';
      tab.title = scene.name;
      tab.textContent = scene.name;
      tab.dataset.sceneId = scene.id;
      tab.addEventListener('click', () => void this.engine.loadScene(index));
      this.rail.appendChild(tab);
    });
    this.root.appendChild(this.rail);
  }

  /**
   * Floor plan minimap. Only rendered when the tour actually has a plan with
   * at least one pinned scene, so tours without one lose no screen space.
   */
  private buildMinimap() {
    const plan = this.data.floorPlans?.find((p) => p.imageUrl && p.markers?.length);
    if (!plan) return;

    const wrap = el('div', 'pt-map pt-panel');

    const head = el('div', 'pt-map-head');
    const title = el('span');
    title.textContent = plan.name || 'Floor plan';
    const toggle = el('b');
    toggle.textContent = '−';
    head.append(title, toggle);
    head.addEventListener('click', () => {
      const collapsed = wrap.dataset.collapsed === 'true';
      wrap.dataset.collapsed = String(!collapsed);
      toggle.textContent = collapsed ? '−' : '+';
    });

    const body = el('div', 'pt-map-body');
    const img = el('img');
    img.src = plan.imageUrl;
    img.alt = plan.name || 'Floor plan';
    body.appendChild(img);

    // Heading wedge sits under the pins and rotates with the camera.
    this.mapCone = el('div', 'pt-map-cone');
    this.mapCone.style.display = 'none';
    body.appendChild(this.mapCone);

    for (const marker of plan.markers) {
      const scene = this.data.scenes.find((s) => s.id === marker.sceneId);
      if (!scene) continue; // scene deleted after the plan was pinned
      const pin = el('button', 'pt-map-pin');
      (pin as HTMLButtonElement).type = 'button';
      pin.title = scene.name;
      pin.setAttribute('aria-label', `Go to ${scene.name}`);
      pin.style.left = `${marker.x}%`;
      pin.style.top = `${marker.y}%`;
      pin.addEventListener('click', () => void this.engine.goToScene(scene.id));
      body.appendChild(pin);
      this.mapPins.set(scene.id, pin);
    }

    wrap.append(head, body);
    this.root.appendChild(wrap);
  }

  /** Moves the "you are here" wedge to the current scene and camera heading. */
  private updateMinimap(sceneId: string, yaw: number) {
    if (!this.mapCone) return;
    for (const [id, pin] of this.mapPins) {
      pin.dataset.current = String(id === sceneId);
    }
    const pin = this.mapPins.get(sceneId);
    if (!pin) {
      this.mapCone.style.display = 'none';
      return;
    }
    this.mapCone.style.display = '';
    this.mapCone.style.left = pin.style.left;
    this.mapCone.style.top = pin.style.top;
    // Plans are drawn with north up, so the panorama's yaw maps directly to
    // rotation about the pin.
    this.mapCone.style.transform = `rotate(${yaw}deg)`;
  }

  /* ────────────────────────── enquiry capture ───────────────────────── */

  private buildEnquiryButton() {
    const cfg = this.data.leads;
    if (!cfg?.enabled || !cfg.endpoint) return;

    const btn = el('button', 'pt-enquire', `${ICONS.mail}<span>${this.escape(cfg.buttonText)}</span>`);
    btn.type = 'button';
    btn.addEventListener('click', () => this.openEnquiryForm());
    this.root.appendChild(btn);
  }

  private openEnquiryForm() {
    const cfg = this.data.leads;
    if (!cfg) return;
    const scene = this.data.scenes[this.engine.getCurrentIndex()];

    this.openModal(
      cfg.headline,
      `<div class="pt-form-error" id="pt-err" style="display:none"></div>
       <div class="pt-form">
         <input id="pt-name"  type="text"  placeholder="Your name *" autocomplete="name">
         <input id="pt-phone" type="tel"   placeholder="Phone number" autocomplete="tel">
         <input id="pt-email" type="email" placeholder="Email address" autocomplete="email">
         <textarea id="pt-msg" placeholder="Anything you'd like to ask?"></textarea>
       </div>
       <label class="pt-consent">
         <input id="pt-consent" type="checkbox">
         <span>I agree to be contacted about this enquiry.</span>
       </label>`,
    );

    // Repurpose the modal's default Close button into Send. It already carries
    // a "close the modal" listener from openModal(); cloning the node drops
    // that, otherwise every submit would also dismiss the form and the
    // validation messages would never be visible.
    const original = this.modalCard.querySelector('.pt-modal-close') as HTMLButtonElement | null;
    if (!original) return;
    const close = original.cloneNode(true) as HTMLButtonElement;
    original.replaceWith(close);
    close.textContent = 'Send enquiry';

    const cancel = el('button', 'pt-modal-close');
    cancel.type = 'button';
    cancel.textContent = 'Cancel';
    cancel.style.background = 'transparent';
    cancel.style.border = '1px solid var(--pt-border)';
    cancel.style.marginLeft = '8px';
    cancel.addEventListener('click', () => this.closeModal());
    close.after(cancel);

    const errBox = this.modalCard.querySelector('#pt-err') as HTMLElement;
    const val = (id: string) =>
      (this.modalCard.querySelector(id) as HTMLInputElement | null)?.value ?? '';

    close.addEventListener('click', async (e) => {
      e.preventDefault();
      const payload = {
        name: val('#pt-name'),
        phone: val('#pt-phone'),
        email: val('#pt-email'),
        message: val('#pt-msg'),
        sceneName: scene?.name ?? '',
        consent: (this.modalCard.querySelector('#pt-consent') as HTMLInputElement)?.checked === true,
      };

      // Mirror the server's rules so the visitor gets instant feedback.
      if (!payload.name.trim()) return this.showFormError(errBox, 'Please enter your name.');
      if (!payload.phone.trim() && !payload.email.trim()) {
        return this.showFormError(errBox, 'Please give a phone number or an email address.');
      }
      if (!payload.consent) {
        return this.showFormError(errBox, 'Please tick the box so we can contact you.');
      }

      close.disabled = true;
      close.textContent = 'Sending…';
      try {
        const res = await fetch(cfg.endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body?.error || 'Could not send your enquiry.');

        this.modalCard.innerHTML =
          `<div class="pt-form-ok"><b>Thank you, ${this.escape(payload.name)}.</b>` +
          `${this.escape(body.message || 'We will be in touch shortly.')}</div>`;
        const done = el('button', 'pt-modal-close');
        done.type = 'button';
        done.textContent = 'Close';
        done.addEventListener('click', () => this.closeModal());
        this.modalCard.appendChild(done);
      } catch (err) {
        close.disabled = false;
        close.textContent = 'Send enquiry';
        this.showFormError(
          errBox,
          err instanceof Error ? err.message : 'Could not send your enquiry.',
        );
      }
    });
  }

  private showFormError(box: HTMLElement | null, message: string) {
    if (!box) return;
    box.textContent = message;
    box.style.display = '';
  }

  /* ───────────────────────────── behaviour ──────────────────────────── */

  private onSceneChange(sceneId: string) {
    const scene = this.data.scenes.find((s) => s.id === sceneId);
    this.sceneLabel.textContent = scene?.name ?? '';

    for (const node of Array.from(this.rail.children) as HTMLElement[]) {
      const active = node.dataset.sceneId === sceneId;
      node.setAttribute('aria-current', String(active));
      if (active) node.scrollIntoView({ block: 'nearest', inline: 'center' });
    }

    this.updateMinimap(sceneId, this.engine?.getCamera().yaw ?? 0);

    const hasNarration = Boolean(scene?.narrationText || scene?.audioNarration);
    this.narrationBtn.style.display = hasNarration ? '' : 'none';
    this.stopNarration();
    if (this.speaking) this.playNarration();
  }

  private onHotspotHover(hotspot: PanoHotspot | null) {
    if (!hotspot) {
      this.tooltip.classList.remove('pt-visible');
      return;
    }
    this.tooltip.textContent = hotspot.label || hotspot.type;
    this.tooltip.classList.add('pt-visible');
  }

  private onHotspotClick(hotspot: PanoHotspot) {
    const value = hotspot.actionValue || '';
    switch (hotspot.type) {
      case 'navigation':
        return; // the engine already moved the camera into the next scene
      case 'info':
        this.openModal(hotspot.label || 'Details', `<p>${this.escape(value)}</p>`);
        return;
      case 'image':
        this.openModal(
          hotspot.label || 'Image',
          `<img src="${this.escapeAttr(value)}" alt="${this.escapeAttr(hotspot.label)}">`,
        );
        return;
      case 'video':
        this.openModal(hotspot.label || 'Video', this.videoEmbed(value));
        return;
      case 'audio':
        this.openModal(
          hotspot.label || 'Audio',
          `<audio controls autoplay src="${this.escapeAttr(value)}" style="width:100%"></audio>`,
        );
        return;
      case 'phone':
        window.location.href = `tel:${value.replace(/[^\d+]/g, '')}`;
        return;
      case 'link':
      case 'pdf':
        if (/^https?:\/\//i.test(value)) window.open(value, '_blank', 'noopener,noreferrer');
        else this.showToast('This link is not a valid web address');
        return;
      default:
        this.showToast(hotspot.label || '');
    }
  }

  private videoEmbed(url: string): string {
    const yt = /(?:youtube\.com\/(?:watch\?v=|embed\/)|youtu\.be\/)([\w-]{11})/.exec(url);
    if (yt) {
      return `<iframe src="https://www.youtube-nocookie.com/embed/${yt[1]}" allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>`;
    }
    const vimeo = /vimeo\.com\/(\d+)/.exec(url);
    if (vimeo) {
      return `<iframe src="https://player.vimeo.com/video/${vimeo[1]}" allow="autoplay; fullscreen" allowfullscreen></iframe>`;
    }
    return `<video controls autoplay playsinline src="${this.escapeAttr(url)}"></video>`;
  }

  private toggleAutoRotate() {
    const on = this.autoRotateBtn.getAttribute('aria-pressed') === 'true';
    this.engine.setAutoRotate(on ? 0 : 6);
    this.autoRotateBtn.setAttribute('aria-pressed', String(!on));
    this.autoRotateBtn.innerHTML = on ? ICONS.play : ICONS.pause;
    this.autoRotateBtn.title = on ? 'Auto-rotate' : 'Stop auto-rotate';
  }

  private toggleNarration() {
    if (this.speaking) {
      this.speaking = false;
      this.stopNarration();
      this.narrationBtn.innerHTML = ICONS.sound;
    } else {
      this.speaking = true;
      this.playNarration();
      this.narrationBtn.innerHTML = ICONS.mute;
    }
  }

  private playNarration() {
    const scene = this.data.scenes[this.engine?.getCurrentIndex() ?? 0];
    if (!scene || !this.speaking) return;

    if (scene.audioNarration) {
      this.audio = new Audio(scene.audioNarration);
      void this.audio.play().catch(() => this.showToast('Narration could not play'));
      return;
    }
    if (scene.narrationText && 'speechSynthesis' in window) {
      const utterance = new SpeechSynthesisUtterance(scene.narrationText);
      utterance.rate = 0.96;
      speechSynthesis.speak(utterance);
    }
  }

  private stopNarration() {
    this.audio?.pause();
    this.audio = null;
    if ('speechSynthesis' in window) speechSynthesis.cancel();
  }

  private async setupXRButtons() {
    const support = await PanoEngine.xrSupport();
    if (!support.vr && !support.ar) return;

    const actions = this.root.querySelector('.pt-actions');
    if (!actions) return;

    const add = (mode: 'vr' | 'ar', icon: string, label: string) => {
      const btn = button('pt-btn pt-btn-wide', `${icon}<span>${label}</span>`, `Enter ${label}`);
      btn.addEventListener('click', async () => {
        try {
          await this.engine.enterXR(mode);
        } catch (err) {
          this.showToast(err instanceof Error ? err.message : `${label} unavailable`);
        }
      });
      actions.insertBefore(btn, actions.firstChild);
    };

    if (support.ar) add('ar', ICONS.ar, 'AR');
    if (support.vr) add('vr', ICONS.vr, 'VR');
  }

  private showAbout() {
    const scene = this.data.scenes[this.engine.getCurrentIndex()];
    const parts = [`<p>${this.escape(this.data.description || '')}</p>`];
    if (scene?.narrationText) {
      parts.push(`<h2>${this.escape(scene.name)}</h2><p>${this.escape(scene.narrationText)}</p>`);
    }
    parts.push(
      '<p style="opacity:.6;font-size:13px">Drag to look around · scroll or pinch to zoom · ' +
        'arrow keys to pan · Page Up / Page Down to change scene.</p>',
    );
    this.openModal(this.data.name, parts.join(''));
  }

  private openModal(title: string, bodyHtml: string) {
    this.modalCard.innerHTML = `<h2>${this.escape(title)}</h2>${bodyHtml}`;
    const close = el('button', 'pt-modal-close');
    close.type = 'button';
    close.textContent = 'Close';
    close.addEventListener('click', () => this.closeModal());
    this.modalCard.appendChild(close);
    this.modal.hidden = false;
    close.focus();
  }

  private closeModal() {
    if (this.modal.hidden) return;
    this.modal.hidden = true;
    this.modalCard.innerHTML = '';
  }

  private toastTimer = 0;
  private showToast(message: string) {
    if (!message) return;
    this.toast.textContent = message;
    this.toast.classList.add('pt-visible');
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toast.classList.remove('pt-visible'), 3200);
  }

  private escape(value: string): string {
    const div = document.createElement('div');
    div.textContent = value ?? '';
    return div.innerHTML;
  }

  private escapeAttr(value: string): string {
    return this.escape(value).replace(/"/g, '&quot;');
  }
}

const mount = document.getElementById('tour');
if (mount) {
  const player = new TourPlayer(mount);
  // Published as a small integration surface so an embedding page can drive
  // the tour (deep-link to a scene, sync it with its own UI) without forking
  // the player. Also what makes the tour inspectable from the console.
  (window as unknown as { tourPlayer: TourPlayer }).tourPlayer = player;
  void player.start();
}
