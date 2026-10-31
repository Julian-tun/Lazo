// Calidad automática del ESPECTADOR cuando recibe por el SFU.
//
// El SFU manda siempre la capa que pedimos (f = alta, h = media, q = baja). Por eso el
// propio espectador mide cómo le llega el video y pide otra capa si hace falta:
//   - si se pierden paquetes o el video se retrasa/congela -> bajar una capa;
//   - si todo va bien un buen rato -> intentar subir una capa.
// Cada espectador decide por su cuenta: si uno tiene mal internet, a los demás no les afecta.
//
// Este archivo no usa nada del navegador salvo readRecvSample, para poder probar la lógica sola.
import type { SfuLayer } from '@lazo/shared';

/** Contadores acumulados del video que llega (de getStats). */
export interface RecvSample {
  at: number; // ms
  lost: number; // paquetes perdidos
  received: number; // paquetes recibidos
  freezes: number; // congelamientos detectados por el navegador
  jbDelay: number; // tiempo total en el "colchón" de espera (s)
  jbCount: number; // cuadros que salieron de ese colchón
  frames: number; // cuadros decodificados
  height: number | null; // alto actual en píxeles
}

/** Cómo fue el último intervalo (diferencia entre dos muestras). */
export interface Judgement {
  lossRate: number; // 0..1
  froze: boolean;
  delayMs: number | null; // espera media en el colchón (sube cuando la red no da abasto)
  fps: number;
}

export async function readRecvSample(pc: RTCPeerConnection): Promise<RecvSample | null> {
  const stats = await pc.getStats();
  let v: Record<string, number | undefined> | undefined;
  stats.forEach((s) => {
    if (s.type === 'inbound-rtp' && s.kind === 'video') v = s;
  });
  if (!v) return null;
  return {
    at: v.timestamp ?? Date.now(),
    lost: Math.max(0, v.packetsLost ?? 0),
    received: v.packetsReceived ?? 0,
    freezes: v.freezeCount ?? 0,
    jbDelay: v.jitterBufferDelay ?? 0,
    jbCount: v.jitterBufferEmittedCount ?? 0,
    frames: v.framesDecoded ?? 0,
    height: v.frameHeight ?? null,
  };
}

export function judge(prev: RecvSample, cur: RecvSample): Judgement {
  const lost = Math.max(0, cur.lost - prev.lost);
  const got = Math.max(0, cur.received - prev.received);
  const secs = Math.max(0.001, (cur.at - prev.at) / 1000);
  const jbN = cur.jbCount - prev.jbCount;
  return {
    lossRate: lost + got > 0 ? lost / (lost + got) : 0,
    froze: cur.freezes > prev.freezes,
    delayMs: jbN > 0 ? ((cur.jbDelay - prev.jbDelay) / jbN) * 1000 : null,
    fps: Math.max(0, cur.frames - prev.frames) / secs,
  };
}

// ---- Reglas (ajustables) ----
const LOSS_BAD = 0.03; // 3 % de paquetes perdidos = mal
const LOSS_SEVERE = 0.1; // 10 % = muy mal: bajar ya, sin esperar otra medición
const DELAY_BAD_MS = 500; // más de medio segundo de espera = la red no da abasto
const GRACE_MS = 5000; // tras cambiar de capa, esperar a que se asiente antes de juzgar
const UPGRADE_WAIT_MS = 20_000; // tiempo bien antes de intentar subir
const UPGRADE_WAIT_MAX_MS = 160_000; // si subir sale mal varias veces, esperar hasta esto
const FAILED_UPGRADE_MS = 20_000; // bajar tan pronto después de subir = la subida no funcionó

const ORDER: SfuLayer[] = ['q', 'h', 'f']; // de peor a mejor
const down = (l: SfuLayer): SfuLayer => ORDER[Math.max(0, ORDER.indexOf(l) - 1)];
const up = (l: SfuLayer): SfuLayer => ORDER[Math.min(ORDER.length - 1, ORDER.indexOf(l) + 1)];

/** Decide cuándo bajar o subir de capa. Una instancia por espectador. */
export class AutoLayer {
  layer: SfuLayer;
  private badStreak = 0;
  private goodSince: number | null = null;
  private lastChangeAt = 0;
  private lastUpgradeAt = -Infinity;
  private upgradeWait = UPGRADE_WAIT_MS;

  constructor(initial: SfuLayer, now = 0) {
    this.layer = initial;
    this.lastChangeAt = now;
  }

  /** Recibe cómo fue el último intervalo. Devuelve la capa nueva a pedir, o null si no hay que cambiar. */
  next(j: Judgement, now: number): SfuLayer | null {
    if (now - this.lastChangeAt < GRACE_MS) return null;

    const severe = j.lossRate >= LOSS_SEVERE;
    const bad =
      severe ||
      j.lossRate >= LOSS_BAD ||
      (j.delayMs !== null && j.delayMs > DELAY_BAD_MS) ||
      (j.froze && j.lossRate >= 0.01);

    if (bad) {
      this.goodSince = null;
      this.badStreak++;
    } else {
      this.badStreak = 0;
      this.goodSince ??= now;
    }

    // Bajar: muy mal una vez, o mal dos mediciones seguidas
    if ((severe || this.badStreak >= 2) && this.layer !== 'q') {
      // Si acabamos de subir y ya va mal, esa capa no aguanta: esperar más antes de reintentar
      if (now - this.lastUpgradeAt < FAILED_UPGRADE_MS) {
        this.upgradeWait = Math.min(this.upgradeWait * 2, UPGRADE_WAIT_MAX_MS);
      }
      return this.change(down(this.layer), now);
    }

    // Subir: todo bien durante un buen rato
    if (!bad && this.layer !== 'f' && this.goodSince !== null && now - this.goodSince >= this.upgradeWait) {
      this.lastUpgradeAt = now;
      return this.change(up(this.layer), now);
    }
    return null;
  }

  /**
   * Pone la capa que de verdad se está recibiendo (p. ej. el servidor no aceptó el cambio, o el
   * espectador la eligió a mano) y empieza a juzgar de cero desde ahí.
   */
  sync(layer: SfuLayer, now: number): void {
    this.change(layer, now);
  }

  private change(to: SfuLayer, now: number): SfuLayer {
    this.layer = to;
    this.lastChangeAt = now;
    this.badStreak = 0;
    this.goodSince = null;
    return to;
  }
}
