import { REGIONS, type Beach, type Region } from '../world/locations';
import { formatLocalTime } from '../world/live';
import { MAP_HEIGHT, MAP_WIDTH, continentsPath, project } from './beachMap';

/**
 * The place picker on the Beaches tab: which real beach a beach sits at.
 *
 * Closed, it is one row: the current place and its local time. Open, it
 * shows a search box, "near me", a world map with every place as a dot,
 * and the places grouped by region (west to east inside a region), each
 * with its local time and, when the server has it, its weather.
 */

/** Lower case, accents dropped: "Viña" and "vina" match. */
export function fold(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

/** Places whose name, town or region contains every word of the query. */
export function searchPlaces(beaches: readonly Beach[], query: string): Beach[] {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (!words.length) return [...beaches];
  return beaches.filter((b) => {
    const hay = fold(`${b.name} ${b.place} ${b.region}`);
    return words.every((w) => hay.includes(w));
  });
}

/** Places by region, in REGIONS order, west to east inside each; empty regions left out. */
export function groupByRegion(beaches: readonly Beach[]): { region: Region; beaches: Beach[] }[] {
  return REGIONS.map((region) => ({
    region,
    beaches: beaches.filter((b) => b.region === region).sort((a, b) => a.lon - b.lon),
  })).filter((g) => g.beaches.length > 0);
}

/** Short weather for a place, e.g. "☀ 24°"; set by the weather layer. */
export type PlaceWeatherText = (id: string) => string | undefined;

const SVG = 'http://www.w3.org/2000/svg';

export class PlacePicker {
  readonly el: HTMLDivElement;
  private current: string | null = null;
  private readonly summary: HTMLButtonElement;
  private readonly body: HTMLDivElement;
  private readonly search: HTMLInputElement;
  private readonly list: HTMLDivElement;
  private readonly markers = new Map<string, SVGGElement>();
  private readonly rows = new Map<string, HTMLButtonElement>();
  private weather: PlaceWeatherText = () => undefined;

  constructor(
    private readonly beaches: readonly Beach[],
    private readonly h: { pick: (id: string) => void; nearMe: () => void },
  ) {
    this.el = document.createElement('div');
    this.el.className = 'place-picker';
    this.el.innerHTML = `
      <button type="button" class="pp-summary" aria-expanded="false">
        <span class="pp-label">place</span>
        <span class="pp-now"><b></b><span></span></span>
        <span class="pp-change">change</span>
      </button>
      <div class="pp-body" hidden>
        <div class="pp-tools">
          <input type="search" class="pp-search" placeholder="search" aria-label="Search places" autocomplete="off" spellcheck="false" />
          <button type="button" class="action near" data-act="near">near me</button>
        </div>
        <div class="beach-map pp-map"></div>
        <div class="pp-list" role="listbox" aria-label="Places"></div>
        <div class="status pp-empty" hidden>no places match</div>
      </div>`;
    this.summary = this.el.querySelector('.pp-summary')!;
    this.body = this.el.querySelector('.pp-body')!;
    this.search = this.el.querySelector('.pp-search')!;
    this.list = this.el.querySelector('.pp-list')!;
    this.buildMap();
    this.buildList();
    this.summary.addEventListener('click', () => this.setOpen(this.body.hidden));
    this.search.addEventListener('input', () => this.filter());
    this.search.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const first = searchPlaces(this.beaches, this.search.value)[0];
        if (first) this.choose(first.id);
      }
    });
    this.el.querySelector<HTMLButtonElement>('[data-act="near"]')!.addEventListener('click', () => {
      this.h.nearMe();
      this.setOpen(false);
    });
  }

  get isOpen(): boolean {
    return !this.body.hidden;
  }

  setOpen(open: boolean): void {
    this.body.hidden = !open;
    this.summary.setAttribute('aria-expanded', String(open));
    if (open) {
      this.refresh();
      this.rows.get(this.current ?? '')?.scrollIntoView?.({ block: 'nearest' });
    } else if (this.search.value) {
      this.search.value = '';
      this.filter();
    }
  }

  setCurrent(id: string | null | undefined): void {
    this.current = id ?? null;
    for (const [bid, row] of this.rows) {
      const on = bid === this.current;
      row.classList.toggle('on', on);
      row.setAttribute('aria-selected', String(on));
    }
    for (const [bid, g] of this.markers) g.classList.toggle('here', bid === this.current);
    this.refreshSummary();
  }

  setWeather(fn: PlaceWeatherText): void {
    this.weather = fn;
    this.refresh();
  }

  /** Local times and weather; called on open and by the owner now and then. */
  refresh(): void {
    this.refreshSummary();
    if (this.body.hidden) return;
    const now = new Date();
    for (const b of this.beaches) {
      const row = this.rows.get(b.id);
      if (!row) continue;
      const w = this.weather(b.id);
      row.querySelector('.pp-time')!.textContent = formatLocalTime(now, b.timeZone);
      row.querySelector('.pp-wx')!.textContent = w ?? '';
    }
  }

  private refreshSummary(): void {
    const b = this.beaches.find((x) => x.id === this.current);
    const name = this.summary.querySelector('.pp-now b')!;
    const sub = this.summary.querySelector('.pp-now span')!;
    name.textContent = b ? b.name : 'choose a place';
    const w = b ? this.weather(b.id) : undefined;
    sub.textContent = b ? [b.place, formatLocalTime(new Date(), b.timeZone), w].filter(Boolean).join(' · ') : '';
  }

  private choose(id: string): void {
    this.setOpen(false);
    if (id !== this.current) {
      this.setCurrent(id);
      this.h.pick(id);
    }
  }

  private filter(): void {
    const hits = new Set(searchPlaces(this.beaches, this.search.value).map((b) => b.id));
    for (const [id, row] of this.rows) row.hidden = !hits.has(id);
    for (const [id, g] of this.markers) g.classList.toggle('dim', !hits.has(id));
    for (const sec of this.list.querySelectorAll<HTMLElement>('.pp-region')) {
      sec.hidden = !sec.querySelector('button:not([hidden])');
    }
    this.el.querySelector<HTMLElement>('.pp-empty')!.hidden = hits.size > 0;
  }

  private buildMap(): void {
    const svg = document.createElementNS(SVG, 'svg');
    svg.setAttribute('viewBox', `0 0 ${MAP_WIDTH} ${MAP_HEIGHT}`);
    svg.setAttribute('role', 'group');
    svg.setAttribute('aria-label', 'Map of places');
    const ocean = document.createElementNS(SVG, 'rect');
    ocean.setAttribute('class', 'ocean');
    ocean.setAttribute('width', String(MAP_WIDTH));
    ocean.setAttribute('height', String(MAP_HEIGHT));
    svg.appendChild(ocean);
    const land = document.createElementNS(SVG, 'path');
    land.setAttribute('class', 'land');
    land.setAttribute('d', continentsPath());
    svg.appendChild(land);
    for (const b of this.beaches) {
      const { x, y } = project(b.lon, b.lat);
      const g = document.createElementNS(SVG, 'g');
      g.setAttribute('class', 'marker');
      g.setAttribute('tabindex', '-1');
      const title = document.createElementNS(SVG, 'title');
      title.textContent = `${b.name} · ${b.place}`;
      g.appendChild(title);
      // a bigger invisible target so small dots are easy to tap
      const hit = document.createElementNS(SVG, 'circle');
      hit.setAttribute('class', 'hit');
      hit.setAttribute('cx', x.toFixed(1));
      hit.setAttribute('cy', y.toFixed(1));
      hit.setAttribute('r', '8');
      g.appendChild(hit);
      const dot = document.createElementNS(SVG, 'circle');
      dot.setAttribute('class', 'dot');
      dot.setAttribute('cx', x.toFixed(1));
      dot.setAttribute('cy', y.toFixed(1));
      dot.setAttribute('r', '3.6');
      g.appendChild(dot);
      g.addEventListener('click', () => this.choose(b.id));
      this.markers.set(b.id, g);
      svg.appendChild(g);
    }
    this.el.querySelector('.pp-map')!.appendChild(svg);
  }

  private buildList(): void {
    for (const { region, beaches } of groupByRegion(this.beaches)) {
      const sec = document.createElement('div');
      sec.className = 'pp-region';
      const h = document.createElement('div');
      h.className = 'pp-region-name';
      h.textContent = region;
      sec.appendChild(h);
      for (const b of beaches) {
        const row = document.createElement('button');
        row.type = 'button';
        row.setAttribute('role', 'option');
        row.dataset.v = b.id;
        row.innerHTML = `<span class="pp-name"><b></b><span></span></span><span class="pp-wx"></span><span class="pp-time"></span>`;
        row.querySelector('b')!.textContent = b.name;
        row.querySelector('.pp-name span')!.textContent = b.place;
        row.addEventListener('click', () => this.choose(b.id));
        row.addEventListener('mouseenter', () => this.markers.get(b.id)?.classList.add('hover'));
        row.addEventListener('mouseleave', () => this.markers.get(b.id)?.classList.remove('hover'));
        this.rows.set(b.id, row);
        sec.appendChild(row);
      }
      this.list.appendChild(sec);
    }
  }
}
